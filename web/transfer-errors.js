// SPDX-License-Identifier: MIT
// Serializable transport errors. Keep the original diagnostic separate from
// the stable user-facing translation key across Worker and per-file retries.
export function transferError(errorCode,message,errorValues={}) {
  return Object.assign(new Error(message),{errorCode,errorValues});
}
export function transferErrorDetails(value) {
  if(value==null)return {error:null,errorCode:null,errorValues:null};
  const error=String(value.message??value.error??value);
  return {error,errorCode:typeof value.errorCode==='string'?value.errorCode:null,
    errorValues:value.errorValues&&typeof value.errorValues==='object'?{...value.errorValues}:null};
}
