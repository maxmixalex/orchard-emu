// SPDX-License-Identifier: MIT
package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Independent protocol peer: deterministic bytes depend on absolute addresses
// (including high address bits) so a repeated or swapped block cannot pass.
type fakeDevice struct {
	block, pos, generation int
	mode                   string
	commands               []byte
	blockReads             [64]int
	corruptFirst           bool
	mutation               func(*fakeDevice, []byte) []byte
}

func (*fakeDevice) Product() string { return streamerProduct }
func (*fakeDevice) Close() error    { return nil }
func sampleByte(off int) byte       { return byte((off*17 + off/251 + off/16384*7 + 3) & 255) }
func sampleBlock(block, generation int, changed bool) []byte {
	b := make([]byte, blockBytes)
	for i := range b {
		b[i] = sampleByte(block*blockBytes + i)
	}
	if changed && generation > 0 {
		b[123] ^= 0x80
	}
	return b
}
func (d *fakeDevice) WriteReport(p []byte) error {
	if len(p) != 64 || !bytes.Equal(p[1:5], []byte{1, 'H', '3', '9'}) {
		return errors.New("bad command")
	}
	d.commands = append(d.commands, p[0])
	switch p[0] {
	case '?':
		d.mode = "info"
	case 'S':
		d.mode = "data"
		d.blockReads[0]++
	case 'R':
		if d.mode != "checkpoint" || int(p[5]) != d.block || int(get32(p, 8)) != d.block*blockBytes {
			return errors.New("bad retry")
		}
		d.generation++
		d.pos = 0
		d.mode = "data"
		d.blockReads[d.block]++
	case 'A':
		if d.mode != "checkpoint" || int(p[5]) != d.block || int(get32(p, 8)) != d.block*blockBytes {
			return errors.New("bad ack")
		}
		d.block++
		d.generation = 0
		d.pos = 0
		if d.block == 64 {
			d.mode = "end"
		} else {
			d.mode = "data"
			d.blockReads[d.block]++
		}
	default:
		return errors.New("unexpected command")
	}
	return nil
}
func (d *fakeDevice) ReadReport(time.Duration) ([]byte, error) {
	b := make([]byte, 64)
	switch d.mode {
	case "info":
		copy(b, []byte{'I', 1, 'H', '3', '9', 'R', 'O', 'M'})
		put32(b, 8, flashBytes)
		put32(b, 12, blockBytes)
		put32(b, 16, dataBytes)
	case "data":
		if d.pos == blockBytes {
			b[0] = 'C'
			b[1] = 1
			b[2] = byte(d.block)
			put32(b, 4, uint32(d.block*blockBytes))
			put32(b, 8, blockBytes)
			data := sampleBlock(d.block, d.generation, false)
			put32(b, 12, blockSum(data))
			put32(b, 16, fnv1a(data))
			d.mode = "checkpoint"
		} else {
			n := dataBytes
			if blockBytes-d.pos < n {
				n = blockBytes - d.pos
			}
			b[0] = 'D'
			b[1] = byte(n)
			binary.LittleEndian.PutUint16(b[2:4], uint16(d.pos/dataBytes))
			put32(b, 4, uint32(d.block*blockBytes+d.pos))
			for i := 0; i < n; i++ {
				b[8+i] = sampleByte(d.block*blockBytes + d.pos + i)
			}
			if d.corruptFirst && d.block == 3 && d.generation == 0 && d.pos == 560 {
				b[8] ^= 0x55
			}
			d.pos += n
		}
	case "end":
		copy(b, []byte{'E', 1, 'H', '3', '9', 'R', 'O', 'M'})
		put32(b, 8, flashBytes)
		put32(b, 16, passWord)
		var sum uint32
		for i := 0; i < flashBytes; i++ {
			sum += uint32(sampleByte(i))
		}
		put32(b, 12, sum)
	default:
		return nil, errors.New("read outside active stream")
	}
	if d.mutation != nil {
		b = d.mutation(d, b)
	}
	return b, nil
}

func TestFullImageTwoReadsAndRetry(t *testing.T) {
	d := &fakeDevice{corruptFirst: true}
	var progress bytes.Buffer
	r, err := receiveImage(d, &progress)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Image) != flashBytes || len(r.Blocks) != 64 || r.Retries != 1 {
		t.Fatal("wrong geometry/retry count")
	}
	for i, b := range r.Image {
		if b != sampleByte(i) {
			t.Fatalf("wrong byte at %d", i)
		}
	}
	for block, n := range d.blockReads {
		want := 2
		if block == 3 {
			want = 3
		}
		if n != want {
			t.Fatalf("block %d read %d times", block, n)
		}
		if r.Blocks[block].ReadPasses != 2 || r.Blocks[block].SHA256 != digest(sampleBlock(block, 0, false)) {
			t.Fatal("incomplete block evidence")
		}
	}
	if !strings.Contains(progress.String(), "retry 1/3") {
		t.Fatal("missing retry report")
	}
	if bytes.Count(d.commands, []byte{'A'}) != 64 || bytes.Count(d.commands, []byte{'R'}) != 65 {
		t.Fatal("wrong handshake")
	}
}

func TestRejectMalformedAndUnstableStreams(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*fakeDevice, []byte) []byte
		want   string
	}{
		{"short", func(d *fakeDevice, p []byte) []byte {
			if p[0] == 'D' {
				return p[:63]
			}
			return p
		}, "short report"},
		{"info-version", func(d *fakeDevice, p []byte) []byte {
			if p[0] == 'I' {
				p[1] = 2
			}
			return p
		}, "INFO"},
		{"wrong-total", func(d *fakeDevice, p []byte) []byte {
			if p[0] == 'I' {
				put32(p, 8, 2*flashBytes)
			}
			return p
		}, "geometry"},
		{"unknown", func(d *fakeDevice, p []byte) []byte {
			if p[0] == 'D' {
				p[0] = 'Q'
			}
			return p
		}, "unexpected report"},
		{"sequence", func(d *fakeDevice, p []byte) []byte {
			if p[0] == 'D' {
				p[2] ^= 1
			}
			return p
		}, "retry limit"},
		{"offset", func(d *fakeDevice, p []byte) []byte {
			if p[0] == 'D' {
				put32(p, 4, get32(p, 4)+1)
			}
			return p
		}, "retry limit"},
		{"too-much-data", func(d *fakeDevice, p []byte) []byte {
			if p[0] == 'D' {
				p[1] = 57
			}
			return p
		}, "retry limit"},
		{"zero-data", func(d *fakeDevice, p []byte) []byte {
			if p[0] == 'D' {
				p[1] = 0
			}
			return p
		}, "retry limit"},
		{"checkpoint-version", func(d *fakeDevice, p []byte) []byte {
			if p[0] == 'C' {
				p[1] = 2
			}
			return p
		}, "retry limit"},
		{"checkpoint-block", func(d *fakeDevice, p []byte) []byte {
			if p[0] == 'C' {
				p[2]++
			}
			return p
		}, "retry limit"},
		{"checkpoint-length", func(d *fakeDevice, p []byte) []byte {
			if p[0] == 'C' {
				put32(p, 8, blockBytes-1)
			}
			return p
		}, "retry limit"},
		{"checkpoint-sum", func(d *fakeDevice, p []byte) []byte {
			if p[0] == 'C' {
				p[12] ^= 1
			}
			return p
		}, "retry limit"},
		{"checkpoint-fnv", func(d *fakeDevice, p []byte) []byte {
			if p[0] == 'C' {
				p[16] ^= 1
			}
			return p
		}, "retry limit"},
		{"end-total", func(d *fakeDevice, p []byte) []byte {
			if p[0] == 'E' {
				p[12] ^= 1
			}
			return p
		}, "END"},
		{"end-marker", func(d *fakeDevice, p []byte) []byte {
			if p[0] == 'E' {
				p[16] = 0
			}
			return p
		}, "END"},
		{"changing-valid-block", func(d *fakeDevice, p []byte) []byte {
			if d.block == 0 && d.generation > 0 {
				if p[0] == 'D' && int(get32(p, 4)) <= 123 && int(get32(p, 4))+int(p[1]) > 123 {
					p[8+123-int(get32(p, 4))] ^= 0x80
				}
				if p[0] == 'C' {
					data := sampleBlock(0, 1, true)
					put32(p, 12, blockSum(data))
					put32(p, 16, fnv1a(data))
				}
			}
			return p
		}, "NOR reads differ"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := &fakeDevice{mutation: tt.mutate}
			r, err := receiveImage(d, io.Discard)
			if err == nil || !strings.Contains(err.Error(), tt.want) || r != nil {
				t.Fatalf("got %v, want %s", err, tt.want)
			}
		})
	}
}

func TestNeverOverwriteOrLeavePartialReservation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "capture.bin")
	if err := os.WriteFile(path+".json", []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := reserveOutputs(path); err == nil {
		t.Fatal("replaced existing sidecar")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("left partial reservation")
	}
	data, _ := os.ReadFile(path + ".json")
	if string(data) != "original" {
		t.Fatal("modified existing sidecar")
	}
	os.Remove(path + ".json")
	if err := os.WriteFile(path, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := reserveOutputs(path); err == nil {
		t.Fatal("replaced existing image")
	}
	data, _ = os.ReadFile(path)
	if string(data) != "original" {
		t.Fatal("modified existing image")
	}
}

func TestManifestDoesNotInventHardwareIdentity(t *testing.T) {
	r, err := receiveImage(&fakeDevice{}, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	m := captureManifest(r, "hp39gs", "C2.22", false)
	for _, key := range []string{"physical_mapping_verified", "authenticated_hardware_provenance", "boot_verified", "catalog_admitted", "separate_capture_compared"} {
		if m[key] != false {
			t.Fatalf("unsupported assertion %s", key)
		}
	}
	if m["independent_block_reads_equal"] != true || m["read_passes_per_block"] != 2 {
		t.Fatal("missing double-read evidence")
	}
}
