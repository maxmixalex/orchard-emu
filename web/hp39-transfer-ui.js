// SPDX-License-Identifier: MIT
// Labels shown by the stock HP39g+/39gs/40gs send/receive menus.
export function hp39TransferMenus(model,transport='usb'){
  return model===1?{wire:'HP39/40 (Wire)',disk:'Disk drive…'}:
    {wire:`HP39/40 (${transport==='serial'?'Ser':'USB'})`,disk:transport==='serial'?'Ser. Disk drive…':'USB Disk drive…'};
}
