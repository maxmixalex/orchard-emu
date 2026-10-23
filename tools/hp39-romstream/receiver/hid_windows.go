//go:build windows

// SPDX-License-Identifier: MIT
// From hpclang, Copyright (c) 2026 Max Alex. Orchard changes: strict device
// identity/report geometry and cancellation completion before releasing memory.
package main

import (
	"fmt"
	"runtime"
	"syscall"
	"time"
	"unsafe"
)

type guid struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

type spDeviceInterfaceData struct {
	CbSize             uint32
	InterfaceClassGUID guid
	Flags              uint32
	Reserved           uintptr
}

type hiddAttributes struct {
	Size          uint32
	VendorID      uint16
	ProductID     uint16
	VersionNumber uint16
}

type hidpCaps struct {
	Usage                     uint16
	UsagePage                 uint16
	InputReportByteLength     uint16
	OutputReportByteLength    uint16
	FeatureReportByteLength   uint16
	Reserved                  [17]uint16
	NumberLinkCollectionNodes uint16
	NumberInputButtonCaps     uint16
	NumberInputValueCaps      uint16
	NumberInputDataIndices    uint16
	NumberOutputButtonCaps    uint16
	NumberOutputValueCaps     uint16
	NumberOutputDataIndices   uint16
	NumberFeatureButtonCaps   uint16
	NumberFeatureValueCaps    uint16
	NumberFeatureDataIndices  uint16
}

type overlapped struct {
	Internal     uintptr
	InternalHigh uintptr
	Offset       uint32
	OffsetHigh   uint32
	HEvent       uintptr
}

type windowsHID struct {
	handle    uintptr
	inputLen  int
	outputLen int
	product   string
}

const (
	vidHP       = 0x03f0
	pidHP39     = 0x0121
	usagePage   = 0xffab
	usage       = 0x0200
	hidpSuccess = 0x00110000

	digcfPresent         = 0x00000002
	digcfDeviceInterface = 0x00000010
	genericRead          = 0x80000000
	genericWrite         = 0x40000000
	fileShareRead        = 0x00000001
	fileShareWrite       = 0x00000002
	openExisting         = 3
	fileFlagOverlapped   = 0x40000000

	errorInsufficientBuffer syscall.Errno = 122
	errorNoMoreItems        syscall.Errno = 259
	errorIOPending          syscall.Errno = 997

	waitObject0 = 0
	waitTimeout = 258
)

var (
	setupapi = syscall.NewLazyDLL("setupapi.dll")
	hiddll   = syscall.NewLazyDLL("hid.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")

	procSetupDiGetClassDevsW             = setupapi.NewProc("SetupDiGetClassDevsW")
	procSetupDiEnumDeviceInterfaces      = setupapi.NewProc("SetupDiEnumDeviceInterfaces")
	procSetupDiGetDeviceInterfaceDetailW = setupapi.NewProc("SetupDiGetDeviceInterfaceDetailW")
	procSetupDiDestroyDeviceInfoList     = setupapi.NewProc("SetupDiDestroyDeviceInfoList")

	procHidDGetHidGuid        = hiddll.NewProc("HidD_GetHidGuid")
	procHidDGetAttributes     = hiddll.NewProc("HidD_GetAttributes")
	procHidDGetProductString  = hiddll.NewProc("HidD_GetProductString")
	procHidDGetPreparsedData  = hiddll.NewProc("HidD_GetPreparsedData")
	procHidDFreePreparsedData = hiddll.NewProc("HidD_FreePreparsedData")
	procHidPGetCaps           = hiddll.NewProc("HidP_GetCaps")

	procCreateFileW         = kernel32.NewProc("CreateFileW")
	procCreateEventW        = kernel32.NewProc("CreateEventW")
	procCloseHandle         = kernel32.NewProc("CloseHandle")
	procReadFile            = kernel32.NewProc("ReadFile")
	procWriteFile           = kernel32.NewProc("WriteFile")
	procGetOverlappedResult = kernel32.NewProc("GetOverlappedResult")
	procWaitForSingleObject = kernel32.NewProc("WaitForSingleObject")
	procCancelIoEx          = kernel32.NewProc("CancelIoEx")
)

func errnoValue(err error) syscall.Errno {
	if err == nil {
		return 0
	}
	if e, ok := err.(syscall.Errno); ok {
		return e
	}
	return 0
}

func winErr(name string, err error) error {
	if errno := errnoValue(err); errno != 0 {
		return fmt.Errorf("%s: %w", name, errno)
	}
	return fmt.Errorf("%s failed", name)
}

func detailPath(buf []byte) string {
	if len(buf) <= 4 {
		return ""
	}
	n := (len(buf) - 4) / 2
	words := unsafe.Slice((*uint16)(unsafe.Pointer(&buf[4])), n)
	return syscall.UTF16ToString(words)
}

func enumerateHIDPaths() ([]string, error) {
	var hidGuid guid
	procHidDGetHidGuid.Call(uintptr(unsafe.Pointer(&hidGuid)))

	devInfo, _, err := procSetupDiGetClassDevsW.Call(
		uintptr(unsafe.Pointer(&hidGuid)),
		0,
		0,
		digcfPresent|digcfDeviceInterface,
	)
	if devInfo == 0 || devInfo == ^uintptr(0) {
		return nil, winErr("SetupDiGetClassDevsW", err)
	}
	defer procSetupDiDestroyDeviceInfoList.Call(devInfo)

	var paths []string
	for index := uint32(0); ; index++ {
		iface := spDeviceInterfaceData{CbSize: uint32(unsafe.Sizeof(spDeviceInterfaceData{}))}
		r, _, enumErr := procSetupDiEnumDeviceInterfaces.Call(
			devInfo,
			0,
			uintptr(unsafe.Pointer(&hidGuid)),
			uintptr(index),
			uintptr(unsafe.Pointer(&iface)),
		)
		if r == 0 {
			if errnoValue(enumErr) == errorNoMoreItems {
				break
			}
			return nil, winErr("SetupDiEnumDeviceInterfaces", enumErr)
		}

		var required uint32
		r, _, detailErr := procSetupDiGetDeviceInterfaceDetailW.Call(
			devInfo,
			uintptr(unsafe.Pointer(&iface)),
			0,
			0,
			uintptr(unsafe.Pointer(&required)),
			0,
		)
		if r != 0 || (errnoValue(detailErr) != errorInsufficientBuffer && required == 0) {
			continue
		}
		if required < 8 {
			continue
		}

		buf := make([]byte, required)
		if unsafe.Sizeof(uintptr(0)) == 8 {
			*(*uint32)(unsafe.Pointer(&buf[0])) = 8
		} else {
			*(*uint32)(unsafe.Pointer(&buf[0])) = 6
		}
		r, _, detailErr = procSetupDiGetDeviceInterfaceDetailW.Call(
			devInfo,
			uintptr(unsafe.Pointer(&iface)),
			uintptr(unsafe.Pointer(&buf[0])),
			uintptr(required),
			uintptr(unsafe.Pointer(&required)),
			0,
		)
		if r == 0 {
			continue
		}
		if path := detailPath(buf); path != "" {
			paths = append(paths, path)
		}
	}
	return paths, nil
}

func createFile(path string, access uint32, flags uint32) (uintptr, error) {
	pathW, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	h, _, callErr := procCreateFileW.Call(
		uintptr(unsafe.Pointer(pathW)),
		uintptr(access),
		fileShareRead|fileShareWrite,
		0,
		openExisting,
		uintptr(flags),
		0,
	)
	if h == ^uintptr(0) {
		return 0, winErr("CreateFileW", callErr)
	}
	return h, nil
}

func queryDevice(path string) (product string, caps hidpCaps, ok bool) {
	h, err := createFile(path, 0, 0)
	if err != nil {
		return "", caps, false
	}
	defer procCloseHandle.Call(h)

	attr := hiddAttributes{Size: uint32(unsafe.Sizeof(hiddAttributes{}))}
	r, _, _ := procHidDGetAttributes.Call(h, uintptr(unsafe.Pointer(&attr)))
	if r == 0 || attr.VendorID != vidHP || attr.ProductID != pidHP39 {
		return "", caps, false
	}

	name := make([]uint16, 128)
	r, _, _ = procHidDGetProductString.Call(
		h,
		uintptr(unsafe.Pointer(&name[0])),
		uintptr(len(name)*2),
	)
	if r == 0 {
		return "", caps, false
	}
	product = syscall.UTF16ToString(name)
	if product != streamerProduct {
		return "", caps, false
	}

	var preparsed uintptr
	r, _, _ = procHidDGetPreparsedData.Call(h, uintptr(unsafe.Pointer(&preparsed)))
	if r == 0 || preparsed == 0 {
		return "", caps, false
	}
	defer procHidDFreePreparsedData.Call(preparsed)

	status, _, _ := procHidPGetCaps.Call(preparsed, uintptr(unsafe.Pointer(&caps)))
	if uint32(status) != hidpSuccess {
		return "", caps, false
	}
	if caps.UsagePage != usagePage || caps.Usage != usage {
		return "", caps, false
	}
	if caps.InputReportByteLength != 65 || caps.OutputReportByteLength != 65 {
		return "", caps, false
	}
	return product, caps, true
}

func openStreamer(timeout time.Duration) (reportDevice, error) {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for time.Now().Before(deadline) {
		paths, err := enumerateHIDPaths()
		if err != nil {
			lastErr = err
		} else {
			for _, path := range paths {
				product, caps, ok := queryDevice(path)
				if !ok {
					continue
				}
				h, err := createFile(path, genericRead|genericWrite, fileFlagOverlapped)
				if err != nil {
					lastErr = fmt.Errorf("found %s but could not open it for Raw HID I/O; close Conn3x/HP Connectivity Kit: %w", product, err)
					continue
				}
				return &windowsHID{
					handle:    h,
					inputLen:  int(caps.InputReportByteLength),
					outputLen: int(caps.OutputReportByteLength),
					product:   product,
				}, nil
			}
		}
		time.Sleep(250 * time.Millisecond)
	}
	if lastErr != nil {
		return nil, fmt.Errorf("HP39g+ ROM Stream HID device not available: %w", lastErr)
	}
	return nil, fmt.Errorf("HP39g+ ROM Stream HID device not found. Close Conn3x/HP Connectivity Kit, launch the aplet with USB unplugged, then plug the cable in")
}

func (d *windowsHID) Product() string {
	return d.product
}

func (d *windowsHID) Close() error {
	if d.handle == 0 || d.handle == ^uintptr(0) {
		return nil
	}
	r, _, err := procCloseHandle.Call(d.handle)
	d.handle = 0
	if r == 0 {
		return winErr("CloseHandle", err)
	}
	return nil
}

func durationMS(timeout time.Duration) uintptr {
	if timeout <= 0 {
		return 0xffffffff
	}
	ms := timeout / time.Millisecond
	if ms < 1 {
		ms = 1
	}
	if ms > 0xfffffffe {
		ms = 0xfffffffe
	}
	return uintptr(ms)
}

func (d *windowsHID) overlappedIO(proc *syscall.LazyProc, buf []byte, timeout time.Duration) (int, error) {
	if len(buf) == 0 {
		return 0, nil
	}
	event, _, eventErr := procCreateEventW.Call(0, 1, 0, 0)
	if event == 0 {
		return 0, winErr("CreateEventW", eventErr)
	}
	defer procCloseHandle.Call(event)

	ov := overlapped{HEvent: event}
	// Win32 retains both pointers until completion, including cancellation.
	defer func() { runtime.KeepAlive(buf); runtime.KeepAlive(&ov) }()
	var immediate uint32
	r, _, ioErr := proc.Call(
		d.handle,
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)),
		uintptr(unsafe.Pointer(&immediate)),
		uintptr(unsafe.Pointer(&ov)),
	)
	if r != 0 {
		return int(immediate), nil
	}
	if errnoValue(ioErr) != errorIOPending {
		return 0, winErr(proc.Name, ioErr)
	}

	wait, _, waitErr := procWaitForSingleObject.Call(event, durationMS(timeout))
	switch wait {
	case waitObject0:
	case waitTimeout:
		procCancelIoEx.Call(d.handle, uintptr(unsafe.Pointer(&ov)))
		var discarded uint32
		procGetOverlappedResult.Call(d.handle, uintptr(unsafe.Pointer(&ov)), uintptr(unsafe.Pointer(&discarded)), 1)
		return 0, fmt.Errorf("%s timed out after %s", proc.Name, timeout)
	default:
		procCancelIoEx.Call(d.handle, uintptr(unsafe.Pointer(&ov)))
		var discarded uint32
		procGetOverlappedResult.Call(d.handle, uintptr(unsafe.Pointer(&ov)), uintptr(unsafe.Pointer(&discarded)), 1)
		return 0, winErr("WaitForSingleObject", waitErr)
	}

	var transferred uint32
	r, _, resultErr := procGetOverlappedResult.Call(
		d.handle,
		uintptr(unsafe.Pointer(&ov)),
		uintptr(unsafe.Pointer(&transferred)),
		0,
	)
	if r == 0 {
		return 0, winErr("GetOverlappedResult", resultErr)
	}
	return int(transferred), nil
}

func (d *windowsHID) WriteReport(payload []byte) error {
	if len(payload) != 64 {
		return fmt.Errorf("report must be 64 bytes, got %d", len(payload))
	}
	if d.outputLen < 65 {
		return fmt.Errorf("unexpected Windows HID output report length %d", d.outputLen)
	}
	raw := make([]byte, d.outputLen)
	raw[0] = 0
	copy(raw[1:], payload)
	n, err := d.overlappedIO(procWriteFile, raw, readTimeout)
	if err != nil {
		return err
	}
	if n != len(raw) {
		return fmt.Errorf("short HID write: %d/%d", n, len(raw))
	}
	return nil
}

func (d *windowsHID) ReadReport(timeout time.Duration) ([]byte, error) {
	if d.inputLen < 65 {
		return nil, fmt.Errorf("unexpected Windows HID input report length %d", d.inputLen)
	}
	raw := make([]byte, d.inputLen)
	n, err := d.overlappedIO(procReadFile, raw, timeout)
	if err != nil {
		return nil, err
	}
	if n < 65 {
		return nil, fmt.Errorf("short HID read: %d bytes", n)
	}
	if raw[0] != 0 {
		return nil, fmt.Errorf("unexpected HID report ID 0x%02x", raw[0])
	}
	payload := make([]byte, 64)
	copy(payload, raw[1:65])
	return payload, nil
}
