// SPDX-License-Identifier: MIT
// Based on hpclang's H39ROM-HID/1 receiver, Copyright (c) 2026 Max Alex.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"time"
)

const (
	protocolVersion = 2
	flashBytes      = 0x100000
	blockBytes      = 0x4000
	dataBytes       = 56
	fnvOffset       = 2166136261
	fnvPrime        = 16777619
	passWord        = 0x50415353
	readTimeout     = 5 * time.Second
	maxBlockRetries = 3
	streamerProduct = "HP39 ROM Stream V2"
	readerRevision  = 2
)

// Filled by the deterministic package builder after the calculator is built.
// A local test build leaves this empty rather than asserting an unrelated hash.
var calculatorApletSHA string

func calculatorError(p []byte) error {
	if len(p) != 64 || p[0] != '!' || p[1] != protocolVersion {
		return nil
	}
	names := map[byte]string{1: "E03 CABLE LOST", 2: "CANCELLED", 3: "E04 USB TIMEOUT", 4: "E05 USB RESET", 5: "E06 PROTOCOL", 6: "E07 USB CLOCK"}
	name := names[p[2]]
	if name == "" {
		name = fmt.Sprintf("unknown code %d", p[2])
	}
	return fmt.Errorf("calculator %s, block %d/64 read %d; unplug USB and inspect the calculator screen", name, int(p[3])+1, p[4])
}

type reportDevice interface {
	WriteReport([]byte) error
	ReadReport(time.Duration) ([]byte, error)
	Close() error
	Product() string
}

type blockRecord struct {
	Index      int    `json:"index"`
	Offset     int    `json:"offset"`
	Bytes      int    `json:"bytes"`
	SHA256     string `json:"sha256"`
	ReadPasses int    `json:"read_passes"`
	Retries    int    `json:"transport_retries"`
}

type capture struct {
	Image   []byte
	Sum     uint32
	Blocks  []blockRecord
	Retries int
}

func put32(b []byte, off int, v uint32) { binary.LittleEndian.PutUint32(b[off:off+4], v) }
func get32(b []byte, off int) uint32    { return binary.LittleEndian.Uint32(b[off : off+4]) }
func digest(b []byte) string            { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

func command(cmd byte, block byte, offset uint32) []byte {
	b := make([]byte, 64)
	b[0], b[1], b[5] = cmd, protocolVersion, block
	copy(b[2:5], "H39")
	put32(b, 8, offset)
	return b
}

func fnv1a(data []byte) uint32 {
	h := uint32(fnvOffset)
	for _, v := range data {
		h = (h ^ uint32(v)) * fnvPrime
	}
	return h
}

func blockSum(data []byte) uint32 {
	var sum uint32
	for _, v := range data {
		sum += uint32(v)
	}
	return sum
}

// readBlock drains one bounded block through its checkpoint. Corrupt data are
// retriable; malformed framing, absent checkpoints and I/O failures abort.
func readBlock(dev reportDevice, block int) ([]byte, bool, error) {
	base := block * blockBytes
	data := make([]byte, 0, blockBytes)
	var seq uint16
	bad := false
	for reports := 0; reports < (blockBytes+dataBytes-1)/dataBytes+8; reports++ {
		p, err := dev.ReadReport(readTimeout)
		if err != nil {
			return nil, false, err
		}
		if len(p) != 64 {
			return nil, false, fmt.Errorf("short report: %d bytes", len(p))
		}
		if err := calculatorError(p); err != nil {
			return nil, false, err
		}
		switch p[0] {
		case 'D':
			n := int(p[1])
			if bad {
				continue
			}
			if n < 1 || n > dataBytes || len(data)+n > blockBytes ||
				binary.LittleEndian.Uint16(p[2:4]) != seq || int(get32(p, 4)) != base+len(data) {
				bad = true
				continue
			}
			data = append(data, p[8:8+n]...)
			seq++
		case 'C':
			ok := !bad && p[1] == protocolVersion && int(p[2]) == block &&
				int(get32(p, 4)) == base && get32(p, 8) == blockBytes &&
				len(data) == blockBytes && blockSum(data) == get32(p, 12) && fnv1a(data) == get32(p, 16)
			return data, ok, nil
		default:
			return nil, false, fmt.Errorf("unexpected report type 0x%02x", p[0])
		}
	}
	return nil, false, errors.New("checkpoint absent within report limit")
}

// The calculator re-reads volatile NOR on each R command.
// Two equal, independently checksummed reads of every block are required.
// This is one launch with two reads per block, not two independent OS boots.
func receiveImage(dev reportDevice, progress io.Writer) (*capture, error) {
	fmt.Fprintln(progress, "Connected. Requesting reader version and full-ROM geometry...")
	if err := dev.WriteReport(command('?', 0, 0)); err != nil {
		return nil, fmt.Errorf("INFO request: %w", err)
	}
	info, err := dev.ReadReport(readTimeout)
	if err != nil {
		return nil, fmt.Errorf("INFO read: %w", err)
	}
	if err := calculatorError(info); err != nil {
		return nil, err
	}
	if len(info) != 64 || !bytes.Equal(info[:8], []byte{'I', protocolVersion, 'H', '3', '9', 'R', 'O', 'M'}) {
		return nil, errors.New("unexpected INFO report")
	}
	if get32(info, 20) != readerRevision {
		return nil, errors.New("reader revision mismatch: install H39 ROM V2 from this package")
	}
	if get32(info, 8) != flashBytes || get32(info, 12) != blockBytes || get32(info, 16) != dataBytes {
		return nil, errors.New("protocol geometry mismatch")
	}
	fmt.Fprintln(progress, "Reader V2 ready: 1 MiB, 64 blocks, two independent reads per block. Starting...")
	started := time.Now()
	if err := dev.WriteReport(command('S', 0, 0)); err != nil {
		return nil, fmt.Errorf("START: %w", err)
	}
	result := &capture{Image: make([]byte, flashBytes)}
	for block := 0; block < flashBytes/blockBytes; block++ {
		base := block * blockBytes
		retries := 0
		var first []byte
		for pass := 0; pass < 2; {
			fmt.Fprintf(progress, "Block %02d/64: reading pass %d/2...\n", block+1, pass+1)
			data, valid, err := readBlock(dev, block)
			if err != nil {
				return nil, fmt.Errorf("block %02d pass %d: %w", block, pass+1, err)
			}
			if !valid {
				if retries >= maxBlockRetries {
					return nil, fmt.Errorf("block %02d: retry limit exceeded", block)
				}
				retries++
				fmt.Fprintf(progress, "Block %02d: transport validation failed; retry %d/%d\n", block+1, retries, maxBlockRetries)
				if err := dev.WriteReport(command('R', byte(block), uint32(base))); err != nil {
					return nil, err
				}
				continue
			}
			if pass == 0 {
				first = data
				pass++
				if err := dev.WriteReport(command('R', byte(block), uint32(base))); err != nil {
					return nil, err
				}
				continue
			}
			if !bytes.Equal(first, data) {
				return nil, fmt.Errorf("block %02d: two checksum-valid NOR reads differ", block)
			}
			copy(result.Image[base:base+blockBytes], data)
			result.Sum += blockSum(data)
			result.Blocks = append(result.Blocks, blockRecord{block, base, len(data), digest(data), 2, retries})
			result.Retries += retries
			if err := dev.WriteReport(command('A', byte(block), uint32(base))); err != nil {
				return nil, err
			}
			fmt.Fprintf(progress, "Block %02d/64: two reads equal; %d/%d bytes verified; elapsed %s\n", block+1, (block+1)*blockBytes, flashBytes, time.Since(started).Round(time.Second))
			pass++
		}
	}
	end, err := dev.ReadReport(readTimeout)
	if err != nil {
		return nil, fmt.Errorf("END read: %w", err)
	}
	if err := calculatorError(end); err != nil {
		return nil, err
	}
	if len(end) != 64 || !bytes.Equal(end[:8], []byte{'E', protocolVersion, 'H', '3', '9', 'R', 'O', 'M'}) ||
		get32(end, 8) != flashBytes || get32(end, 12) != result.Sum || get32(end, 16) != passWord {
		return nil, errors.New("END summary mismatch")
	}
	return result, nil
}

func captureManifest(result *capture, model, version string, compared bool) map[string]any {
	return map[string]any{
		"schema": "orchard-hp39-rom-capture-v1", "model": model, "stock_rom_version_user_reported": version,
		"protocol": "H39ROM-HID/2", "bytes": len(result.Image), "sha256": digest(result.Image),
		"byte_sum32": fmt.Sprintf("0x%08x", result.Sum), "blocks": result.Blocks,
		"read_passes_per_block": 2, "independent_block_reads_equal": true,
		"separate_capture_compared": compared, "transport_retries": result.Retries,
		"address_space":     "uncached ARM section alias to physical NOR 0x00000000..0x000fffff",
		"boot_region_bytes": 16384, "boot_region_sha256": digest(result.Image[:16384]),
		"vid": "03f0", "pid": "0121", "usb_product": streamerProduct,
		"calculator_upstream_base_commit":   "e240c58c2e9dd3ac4d18002ed9a93d2c7cc67900",
		"calculator_aplet_sha256":           calculatorApletSHA,
		"calculator_reader_revision":        readerRevision,
		"model_identity_source":             "user selection; HID identity does not distinguish 39g+ and 39gs",
		"authenticated_hardware_provenance": false, "physical_mapping_verified": false,
		"boot_verified": false, "catalog_admitted": false,
	}
}

// Reserve both outputs with O_EXCL before asking the user to launch the applet.
// Roll back this invocation's empty/partial files after any error, never a file
// that existed before invocation. FINISH is sent only after both files sync.
func reserveOutputs(path string) (*os.File, *os.File, error) {
	image, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return nil, nil, fmt.Errorf("reserve output: %w", err)
	}
	meta, err := os.OpenFile(path+".json", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		image.Close()
		os.Remove(path)
		return nil, nil, fmt.Errorf("reserve metadata: %w", err)
	}
	return image, meta, nil
}

func run() (retErr error) {
	model, version, output, compare := "hp39gs", "", "", ""
	wait := 120 * time.Second
	flag.StringVar(&model, "model", model, "hp39gs or hp39gplus (user identification)")
	flag.StringVar(&version, "rom-version", version, "optional stock VERSION result")
	flag.StringVar(&output, "o", output, "new output filename; existing files are never replaced")
	flag.StringVar(&compare, "compare", compare, "optional separate previous 1 MiB capture to compare byte-for-byte")
	flag.DurationVar(&wait, "wait", wait, "time to wait for the temporary USB HID device")
	flag.Parse()
	if model != "hp39gs" && model != "hp39gplus" {
		return errors.New("model must be hp39gs or hp39gplus")
	}
	if flag.NArg() > 1 || (flag.NArg() == 1 && output != "") {
		return errors.New("provide one output path, either -o or positional")
	}
	if flag.NArg() == 1 {
		output = flag.Arg(0)
	}
	if output == "" {
		output = model + "-flash.bin"
	}
	if wait <= 0 || wait > 30*time.Minute {
		return errors.New("wait must be between 0 and 30 minutes")
	}
	var prior []byte
	if compare != "" {
		var err error
		prior, err = os.ReadFile(compare)
		if err != nil {
			return err
		}
		if len(prior) != flashBytes {
			return errors.New("comparison capture must be exactly 1 MiB")
		}
	}
	imageFile, metaFile, err := reserveOutputs(output)
	if err != nil {
		return err
	}
	persisted := false
	defer func() {
		imageFile.Close()
		metaFile.Close()
		if !persisted {
			os.Remove(output)
			os.Remove(output + ".json")
		}
	}()
	fmt.Println("H39 ROM V2: launch the new aplet, then follow its USB prompt. Close HP Connectivity Kit/Conn3x before the HID step.")
	fmt.Printf("Waiting up to %s for %s...\n", wait, streamerProduct)
	dev, err := openStreamer(wait, os.Stdout)
	if err != nil {
		return err
	}
	finished := false
	defer func() {
		if !finished {
			_ = dev.WriteReport(command('X', 0, 0))
			fmt.Fprintln(os.Stderr, "Receiver stopped. Unplug the calculator USB cable to let the applet restore the stock OS.")
		}
		if err := dev.Close(); retErr == nil && err != nil {
			retErr = err
		}
	}()
	if dev.Product() != streamerProduct {
		return errors.New("unexpected USB product identity")
	}
	fmt.Printf("Connected: %s; selected model: %s\n", dev.Product(), model)
	result, err := receiveImage(dev, os.Stdout)
	if err != nil {
		return err
	}
	if prior != nil && !bytes.Equal(prior, result.Image) {
		return errors.New("new capture differs from separate previous capture")
	}
	fmt.Fprintln(os.Stdout, "All 64 blocks verified. Writing and syncing the complete ROM and JSON...")
	metadata, err := json.MarshalIndent(captureManifest(result, model, version, prior != nil), "", "  ")
	if err != nil {
		return err
	}
	if _, err = imageFile.Write(result.Image); err != nil {
		return err
	}
	if _, err = metaFile.Write(append(metadata, '\n')); err != nil {
		return err
	}
	if err = imageFile.Sync(); err != nil {
		return err
	}
	if err = metaFile.Sync(); err != nil {
		return err
	}
	if err = imageFile.Close(); err != nil {
		return err
	}
	if err = metaFile.Close(); err != nil {
		return err
	}
	persisted = true
	fmt.Printf("ROM saved: %s (%d bytes)\nSHA-256: %s\n", output, len(result.Image), digest(result.Image))
	if err = dev.WriteReport(command('F', 0, 0)); err != nil {
		return fmt.Errorf("files saved but FINISH failed: %w", err)
	}
	finished = true
	fmt.Println("Dump complete. Unplug USB now; the applet restores hardware state and returns to the stock OS.")
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
}
