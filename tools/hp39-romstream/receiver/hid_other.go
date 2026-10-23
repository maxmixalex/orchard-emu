//go:build !windows

// SPDX-License-Identifier: MIT
// From hpclang, Copyright (c) 2026 Max Alex.
package main

import (
	"fmt"
	"io"
	"time"
)

func openStreamer(time.Duration, io.Writer) (reportDevice, error) {
	return nil, fmt.Errorf("the native HID receiver is supported on Windows only")
}
