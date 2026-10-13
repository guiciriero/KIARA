/**
 * audio_backend_mac.mm
 * Backend macOS para captura de áudio por aplicativo via ScreenCaptureKit (macOS 13+).
 */
#include "audio_backend.h"

#ifdef PLATFORM_MACOS

#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreMedia/CoreMedia.h>
#import <Foundation/Foundation.h>

#include <atomic>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <vector>
#include <unistd.h>

namespace {

struct StreamSharedState {
  std::atomic<bool> stopped{false};
  audio_backend::ChunkCallback callback;
};

// Reamostragem linear simples de float32 estéreo intercalado
void ResampleLinearStereo(const float* input, size_t inFrames, double inRate,
                          std::vector<float>& output, size_t& outFrames, double outRate = 48000.0) {
  if (inFrames == 0 || inRate <= 0.0) {
    output.clear();
    outFrames = 0;
    return;
  }
  double ratio = outRate / inRate;
  outFrames = static_cast<size_t>(inFrames * ratio);
  output.resize(outFrames * 2);

  for (size_t i = 0; i < outFrames; ++i) {
    double srcIdx = i / ratio;
    size_t idx0 = static_cast<size_t>(srcIdx);
    size_t idx1 = (idx0 + 1 < inFrames) ? idx0 + 1 : idx0;
    float t = static_cast<float>(srcIdx - idx0);

    // Canal Esquerdo
    float left = input[idx0 * 2] * (1.0f - t) + input[idx1 * 2] * t;
    // Canal Direito
    float right = input[idx0 * 2 + 1] * (1.0f - t) + input[idx1 * 2 + 1] * t;

    output[i * 2] = left;
    output[i * 2 + 1] = right;
  }
}

}  // namespace

API_AVAILABLE(macos(13.0))
@interface AppAudioOutput : NSObject <SCStreamOutput, SCStreamDelegate> {
  uint32_t _pid;
  std::shared_ptr<StreamSharedState> _state;
}
- (instancetype)initWithPid:(uint32_t)pid state:(std::shared_ptr<StreamSharedState>)state;
@end

@implementation AppAudioOutput

- (instancetype)initWithPid:(uint32_t)pid state:(std::shared_ptr<StreamSharedState>)state {
  self = [super init];
  if (self) {
    _pid = pid;
    _state = state;
  }
  return self;
}

- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
  if (error) {
    NSLog(@"[AudioMac] Captura parou para PID %u com erro: %@", _pid, error.localizedDescription);
  }
}

- (void)stream:(SCStream *)stream
    didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
                   ofType:(SCStreamOutputType)type {
  if (type != SCStreamOutputTypeAudio) {
    return;
  }

  auto state = _state;
  if (!state || state->stopped.load() || !state->callback) {
    return;
  }

  CMFormatDescriptionRef fmtDesc = CMSampleBufferGetFormatDescription(sampleBuffer);
  if (!fmtDesc) return;

  const AudioStreamBasicDescription* asbd =
      CMAudioFormatDescriptionGetStreamBasicDescription(fmtDesc);
  if (!asbd || asbd->mFormatID != kAudioFormatLinearPCM) return;

  CMItemCount numSamples = CMSampleBufferGetNumSamples(sampleBuffer);
  if (numSamples <= 0) return;

  size_t bufferListSize = 0;
  OSStatus status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      sampleBuffer, &bufferListSize, NULL, 0, NULL, NULL, 0, NULL);
  if (status != noErr || bufferListSize == 0) return;

  std::vector<uint8_t> bufferListStorage(bufferListSize);
  AudioBufferList* abl = reinterpret_cast<AudioBufferList*>(bufferListStorage.data());
  CMBlockBufferRef blockBuffer = NULL;

  status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      sampleBuffer, NULL, abl, bufferListSize, kCFAllocatorDefault, kCFAllocatorDefault,
      kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, &blockBuffer);

  if (status != noErr) {
    if (blockBuffer) CFRelease(blockBuffer);
    return;
  }

  bool isNonInterleaved = (asbd->mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0;
  bool isFloat = (asbd->mFormatFlags & kAudioFormatFlagIsFloat) != 0;
  uint32_t channels = asbd->mChannelsPerFrame;
  uint32_t inFrames = static_cast<uint32_t>(numSamples);

  std::vector<float> stereoInterleaved(inFrames * 2, 0.0f);

  if (isFloat && channels >= 2 && isNonInterleaved && abl->mNumberBuffers >= 2) {
    const float* left = static_cast<const float*>(abl->mBuffers[0].mData);
    const float* right = static_cast<const float*>(abl->mBuffers[1].mData);
    if (left && right) {
      for (uint32_t i = 0; i < inFrames; ++i) {
        stereoInterleaved[i * 2] = left[i];
        stereoInterleaved[i * 2 + 1] = right[i];
      }
    }
  } else if (isFloat && channels == 1 && abl->mNumberBuffers >= 1) {
    const float* mono = static_cast<const float*>(abl->mBuffers[0].mData);
    if (mono) {
      for (uint32_t i = 0; i < inFrames; ++i) {
        stereoInterleaved[i * 2] = mono[i];
        stereoInterleaved[i * 2 + 1] = mono[i];
      }
    }
  } else if (isFloat && !isNonInterleaved && channels >= 2 && abl->mNumberBuffers >= 1) {
    const float* src = static_cast<const float*>(abl->mBuffers[0].mData);
    if (src) {
      for (uint32_t i = 0; i < inFrames; ++i) {
        stereoInterleaved[i * 2] = src[i * channels];
        stereoInterleaved[i * 2 + 1] = src[i * channels + 1];
      }
    }
  }

  if (blockBuffer) {
    CFRelease(blockBuffer);
  }

  if (state->stopped.load()) return;

  // Reamostragem se diferente de 48000 Hz
  if (std::abs(asbd->mSampleRate - 48000.0) > 1.0 && asbd->mSampleRate > 0.0) {
    std::vector<float> resampled;
    size_t outFrames = 0;
    ResampleLinearStereo(stereoInterleaved.data(), inFrames, asbd->mSampleRate,
                         resampled, outFrames, 48000.0);
    if (outFrames > 0 && !state->stopped.load()) {
      state->callback(_pid, resampled.data(), static_cast<uint32_t>(outFrames));
    }
  } else {
    state->callback(_pid, stereoInterleaved.data(), inFrames);
  }
}

@end

namespace audio_backend {

struct ActiveStream {
  SCStream* stream;
  AppAudioOutput* output;
  dispatch_queue_t queue;
};

static std::mutex g_mutex;
static std::shared_ptr<StreamSharedState> g_sharedState;
static std::vector<ActiveStream> g_activeStreams;

// Para todas as streams. O chamador DEVE estar segurando g_mutex.
static void StopLocked() {
  if (@available(macOS 13.0, *)) {
    if (g_sharedState) {
      g_sharedState->stopped.store(true);
    }

    for (auto& active : g_activeStreams) {
      if (active.stream) {
        dispatch_semaphore_t semaStop = dispatch_semaphore_create(0);
        [active.stream stopCaptureWithCompletionHandler:^(NSError*) {
          dispatch_semaphore_signal(semaStop);
        }];
        dispatch_semaphore_wait(semaStop, dispatch_time(DISPATCH_TIME_NOW, 3LL * NSEC_PER_SEC));
      }
    }
    g_activeStreams.clear();
    g_sharedState.reset();
  }
}

std::vector<SourceInfo> ListSources() {
  if (@available(macOS 13.0, *)) {
    __block SCShareableContent* contentResult = nil;
    __block NSError* errorResult = nil;
    dispatch_semaphore_t sema = dispatch_semaphore_create(0);

    [SCShareableContent getShareableContentExcludingDesktopWindows:YES
                                              onScreenWindowsOnly:NO
                                                completionHandler:^(SCShareableContent* content, NSError* error) {
      contentResult = content;
      errorResult = error;
      dispatch_semaphore_signal(sema);
    }];

    if (dispatch_semaphore_wait(sema, dispatch_time(DISPATCH_TIME_NOW, 3LL * NSEC_PER_SEC)) != 0) {
      return {};
    }

    if (errorResult != nil || contentResult == nil) {
      return {};
    }

    pid_t myPid = getpid();
    std::set<uint32_t> seenPids;
    std::vector<SourceInfo> sources;

    for (SCRunningApplication* app in contentResult.applications) {
      if (!app.applicationName || app.applicationName.length == 0) continue;
      uint32_t pid = static_cast<uint32_t>(app.processID);
      if (pid == static_cast<uint32_t>(myPid)) continue;
      // Só aplicativos com interface normal (exclui Dock, helpers de AutoFill, serviços XPC)
      NSRunningApplication* running = [NSRunningApplication runningApplicationWithProcessIdentifier:app.processID];
      if (!running || running.activationPolicy != NSApplicationActivationPolicyRegular) continue;
      if (seenPids.insert(pid).second) {
        SourceInfo info;
        info.pid = pid;
        info.processName = app.bundleIdentifier ? [app.bundleIdentifier UTF8String] : [app.applicationName UTF8String];
        info.displayName = [app.applicationName UTF8String];
        sources.push_back(info);
      }
    }
    return sources;
  }
  return {};
}

std::string Start(const std::vector<uint32_t>& pids, ChunkCallback callback) {
  if (@available(macOS 13.0, *)) {
    std::lock_guard<std::mutex> lock(g_mutex);
    StopLocked();

    if (pids.empty()) {
      return "";
    }

    // Obter conteúdo compartilhável
    __block SCShareableContent* shareableContent = nil;
    __block NSError* contentError = nil;
    dispatch_semaphore_t semaContent = dispatch_semaphore_create(0);

    [SCShareableContent getShareableContentExcludingDesktopWindows:YES
                                              onScreenWindowsOnly:NO
                                                completionHandler:^(SCShareableContent* content, NSError* error) {
      shareableContent = content;
      contentError = error;
      dispatch_semaphore_signal(semaContent);
    }];

    if (dispatch_semaphore_wait(semaContent, dispatch_time(DISPATCH_TIME_NOW, 3LL * NSEC_PER_SEC)) != 0) {
      return "Tempo esgotado ao buscar aplicativos do sistema.";
    }

    if (contentError != nil || shareableContent == nil) {
      if (contentError && contentError.code == -3801) {
        return "Permissão de Gravação de Tela negada. Conceda a permissão de Gravação de Tela e Áudio do Sistema em Ajustes do Sistema > Privacidade e Segurança e reinicie o aplicativo.";
      }
      return "Falha ao obter lista de janelas/aplicativos para captura.";
    }

    if (shareableContent.displays.count == 0) {
      return "Nenhum monitor encontrado para captura.";
    }
    SCDisplay* primaryDisplay = shareableContent.displays.firstObject;

    auto sharedState = std::make_shared<StreamSharedState>();
    sharedState->stopped.store(false);
    sharedState->callback = std::move(callback);
    g_sharedState = sharedState;

    for (uint32_t pid : pids) {
      SCRunningApplication* targetApp = nil;
      for (SCRunningApplication* app in shareableContent.applications) {
        if (static_cast<uint32_t>(app.processID) == pid) {
          targetApp = app;
          break;
        }
      }

      if (!targetApp) {
        StopLocked();
        return "Aplicativo com PID " + std::to_string(pid) + " não encontrado.";
      }

      SCContentFilter* filter = [[SCContentFilter alloc] initWithDisplay:primaryDisplay
                                                  includingApplications:@[targetApp]
                                                       exceptingWindows:@[]];

      SCStreamConfiguration* config = [[SCStreamConfiguration alloc] init];
      config.capturesAudio = YES;
      config.sampleRate = 48000;
      config.channelCount = 2;
      config.excludesCurrentProcessAudio = YES;
      config.width = 2;
      config.height = 2;
      config.minimumFrameInterval = CMTimeMake(1, 1);
      config.showsCursor = NO;

      AppAudioOutput* output = [[AppAudioOutput alloc] initWithPid:pid state:sharedState];
      SCStream* stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:output];

      std::string queueName = "com.screenshare.audio." + std::to_string(pid);
      dispatch_queue_t audioQueue = dispatch_queue_create(queueName.c_str(), DISPATCH_QUEUE_SERIAL);

      NSError* addOutputError = nil;
      [stream addStreamOutput:output type:SCStreamOutputTypeAudio sampleHandlerQueue:audioQueue error:&addOutputError];
      [stream addStreamOutput:output type:SCStreamOutputTypeScreen sampleHandlerQueue:audioQueue error:&addOutputError];

      __block NSError* startError = nil;
      dispatch_semaphore_t semaStart = dispatch_semaphore_create(0);

      [stream startCaptureWithCompletionHandler:^(NSError* error) {
        startError = error;
        dispatch_semaphore_signal(semaStart);
      }];

      if (dispatch_semaphore_wait(semaStart, dispatch_time(DISPATCH_TIME_NOW, 5LL * NSEC_PER_SEC)) != 0) {
        StopLocked();
        return "Tempo esgotado ao iniciar captura de áudio para o PID " + std::to_string(pid) + ".";
      }

      if (startError != nil) {
        StopLocked();
        if (startError.code == -3801) {
          return "Permissão de Gravação de Tela negada. Conceda a permissão de Gravação de Tela e Áudio do Sistema em Ajustes do Sistema > Privacidade e Segurança e reinicie o aplicativo.";
        }
        return "Erro ao iniciar captura do PID " + std::to_string(pid) + ": " + [startError.localizedDescription UTF8String];
      }

      ActiveStream active;
      active.stream = stream;
      active.output = output;
      active.queue = audioQueue;
      g_activeStreams.push_back(active);
    }

    return "";
  }
  return "ScreenCaptureKit requer macOS 13.0 ou superior.";
}

void Stop() {
  std::lock_guard<std::mutex> lock(g_mutex);
  StopLocked();
}

}  // namespace audio_backend

#endif  // PLATFORM_MACOS
