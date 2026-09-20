#!/usr/bin/env bash
# Builds src/mp3.wasm from LAME 3.100 + lame.patch + encoder.c using wasi-sdk. Toolchain and sources
# are downloaded into native/.cache on first run. Needs wasm-opt (binaryen) on PATH. Usage: native/build.sh
#
# To change lame.patch: copy the extracted .cache/lame-3.100 aside, edit, then
#   diff -ruN lame-3.100.orig/libmp3lame lame-3.100/libmp3lame | sed 's#lame-3.100.orig/#a/#; s#lame-3.100/#b/#' > lame.patch
set -euo pipefail

cd "$(dirname "$0")"
CACHE=.cache
WASI_SDK_VERSION=34
LAME_VERSION=3.100
LAME_SHA256=ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e
OUT=../src/mp3.wasm

case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) PLATFORM=arm64-macos ;;
    Darwin-x86_64) PLATFORM=x86_64-macos ;;
    Linux-x86_64) PLATFORM=x86_64-linux ;;
    Linux-aarch64) PLATFORM=arm64-linux ;;
    *) echo "unsupported host: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

mkdir -p "$CACHE"
SDK="$CACHE/wasi-sdk-$WASI_SDK_VERSION.0-$PLATFORM"
if [ ! -x "$SDK/bin/clang" ]; then
    curl -fL "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-$WASI_SDK_VERSION/wasi-sdk-$WASI_SDK_VERSION.0-$PLATFORM.tar.gz" | tar xz -C "$CACHE"
fi

if [ ! -f "$CACHE/lame.tar.gz" ]; then
    curl -fL -o "$CACHE/lame.tar.gz" "https://downloads.sourceforge.net/project/lame/lame/$LAME_VERSION/lame-$LAME_VERSION.tar.gz"
fi
echo "$LAME_SHA256  $CACHE/lame.tar.gz" | shasum -a 256 -c -

# Always start from the pristine tarball so lame.patch is applied exactly once, and a patch that no
# longer applies fails the build instead of silently producing a different binary.
LAME="$CACHE/lame-$LAME_VERSION"
rm -rf "$LAME"
tar xz -C "$CACHE" -f "$CACHE/lame.tar.gz"
patch -f -s -p1 -d "$LAME" < lame.patch || { echo "lame.patch does not apply to LAME $LAME_VERSION" >&2; exit 1; }

# mpglib_interface.c (decoder) is left out; everything else is pruned by LTO.
FILES=(encoder.c)
for f in VbrTag bitstream encoder fft gain_analysis id3tag lame newmdct presets psymodel quantize \
    quantize_pvt reservoir set_get tables takehiro util vbrquantize version; do
    FILES+=("$LAME/libmp3lame/$f.c")
done

"$SDK/bin/clang" \
    -DHAVE_CONFIG_H -DNDEBUG -Oz -flto -fno-common -w \
    -mexec-model=reactor --no-wasm-opt \
    -I. -I"$LAME/include" -I"$LAME/libmp3lame" \
    -Wl,--strip-all,--keep-section=target_features \
    -Wl,--wrap=lame_report_def,--wrap=id3tag_write_v1,--wrap=id3tag_write_v2,--wrap=exit \
    -Wl,--wrap=VBR_encode_frame,--wrap=VBR_old_iteration_loop,--wrap=VBR_new_iteration_loop \
    -Wl,--wrap=CBR_iteration_loop,--wrap=InitGainAnalysis,--wrap=AnalyzeSamples,--wrap=GetTitleGain \
    -Wl,--wrap=set_frame_pinfo \
    -o "$OUT" "${FILES[@]}"

# clang runs wasm-opt itself only when it happens to be on PATH; call it explicitly so the output
# does not depend on the host.
wasm-opt -Oz --strip-producers --strip-target-features "$OUT" -o "$OUT"

ls -l "$OUT"
