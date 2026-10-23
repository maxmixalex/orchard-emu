// SPDX-License-Identifier: MIT
package main

import (
	"bufio"
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

type stockDevice struct {
	process *exec.Cmd
	input   io.WriteCloser
	output  *bufio.Scanner
	product string
}

func (d *stockDevice) call(op string, b []byte) (map[string]json.RawMessage, error) {
	request := map[string]string{"op": op}
	if b != nil {
		request["hex"] = hex.EncodeToString(b)
	}
	encoded, _ := json.Marshal(request)
	if _, err := d.input.Write(append(encoded, '\n')); err != nil {
		return nil, err
	}
	if !d.output.Scan() {
		return nil, fmt.Errorf("bridge stopped: %v", d.output.Err())
	}
	var result map[string]json.RawMessage
	if err := json.Unmarshal(d.output.Bytes(), &result); err != nil {
		return nil, err
	}
	if e := result["error"]; e != nil {
		return nil, fmt.Errorf("bridge: %s", e)
	}
	return result, nil
}
func (d *stockDevice) Product() string            { return d.product }
func (d *stockDevice) WriteReport(b []byte) error { _, err := d.call("write", b); return err }
func (d *stockDevice) ReadReport(time.Duration) ([]byte, error) {
	r, err := d.call("read", nil)
	if err != nil {
		return nil, err
	}
	var s string
	if err = json.Unmarshal(r["hex"], &s); err != nil {
		return nil, err
	}
	return hex.DecodeString(s)
}
func (d *stockDevice) Close() error {
	_, err := d.call("close", nil)
	d.input.Close()
	waitErr := d.process.Wait()
	if err != nil {
		return err
	}
	return waitErr
}

func TestStockOSFullCapture(t *testing.T) {
	root := os.Getenv("ORCHARD_STOCK_ROOT")
	if root == "" {
		t.Skip("private original-ROM integration: set ORCHARD_STOCK_ROOT, ORCHARD_STOCK_ROM, ORCHARD_STOCK_CHECKPOINT, ORCHARD_STOCK_OUTPUT")
	}
	rom, checkpoint, out := os.Getenv("ORCHARD_STOCK_ROM"), os.Getenv("ORCHARD_STOCK_CHECKPOINT"), os.Getenv("ORCHARD_STOCK_OUTPUT")
	if rom == "" || checkpoint == "" || out == "" {
		t.Fatal("missing stock integration paths")
	}
	model := os.Getenv("ORCHARD_STOCK_MODEL")
	if model == "" {
		model = "hp39gplus"
	}
	process := exec.Command("node", filepath.Join(root, "tools/test-hp39-romstream-stock.mjs"), rom, checkpoint, out, model)
	process.Dir = root
	process.Stderr = os.Stderr
	input, err := process.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := process.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = process.Start(); err != nil {
		t.Fatal(err)
	}
	d := &stockDevice{process: process, input: input, output: bufio.NewScanner(output)}
	defer func() {
		if err := d.Close(); err != nil {
			t.Error(err)
		}
	}()
	opened, err := d.call("open", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(opened["product"], &d.product); err != nil {
		t.Fatal(err)
	}
	result, err := receiveImage(d, os.Stderr)
	if err != nil {
		_ = d.WriteReport(command('X', 0, 0))
		t.Fatal(err)
	}
	expected, err := os.ReadFile(rom)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(result.Image, expected) {
		t.Fatal("actual stock-OS ARM dump differs from source physical NOR")
	}
	manifest := captureManifest(result, model, os.Getenv("ORCHARD_STOCK_FIXTURE"), false)
	metadata, _ := json.MarshalIndent(manifest, "", "  ")
	if err = os.WriteFile(filepath.Join(out, "capture.json"), append(metadata, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
	if err = d.WriteReport(command('F', 0, 0)); err != nil {
		t.Fatal(err)
	}
	t.Logf("All 1 MiB equal, 64 blocks each read twice through actual ARM USB payload; sha256=%s", digest(result.Image))
}
