/**
 * shared_capture.h — captura DXGI -> textura compartilhada (sem readback)
 */
#pragma once
#include <napi.h>

Napi::Value StartSharedCapture(const Napi::CallbackInfo& info);
Napi::Value ReleaseSharedFrame(const Napi::CallbackInfo& info);
Napi::Value StopSharedCapture(const Napi::CallbackInfo& info);
