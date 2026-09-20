// Thin ABR encoder over libmp3lame. Exported symbols are the contract with src/encoder.ts.
#include <lame.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>

#define EXPORT(name) __attribute__((export_name(name)))

typedef struct {
    lame_t lame;
    int channels;
    float *pcm[2];
    int pcm_capacity;
    unsigned char *out;
    int out_capacity;
} encoder;

static void silent(const char *format, va_list ap) {}
static void arena_reset(void);

static int is_mpeg_rate(int rate) {
    return rate == 16000 || rate == 22050 || rate == 24000 || rate == 32000 || rate == 44100 || rate == 48000;
}

EXPORT("mp3_create")
encoder *mp3_create(int sample_rate, int channels, int kbps, int info_frame) {
    if (channels < 1 || channels > 2) return NULL;
    encoder *e = calloc(1, sizeof(encoder));
    if (!e) return NULL;
    e->channels = channels;
    e->lame = lame_init();
    if (!e->lame) {
        free(e);
        return NULL;
    }
    lame_set_errorf(e->lame, silent);
    lame_set_debugf(e->lame, silent);
    lame_set_msgf(e->lame, silent);
    lame_set_in_samplerate(e->lame, sample_rate);
    // LAME would otherwise pick an output rate from the bitrate and resample; keep the input rate
    // whenever it is a legal MPEG rate so the hot path stays resampler-free.
    if (is_mpeg_rate(sample_rate)) lame_set_out_samplerate(e->lame, sample_rate);
    lame_set_num_channels(e->lame, channels);
    lame_set_mode(e->lame, channels == 1 ? MONO : JOINT_STEREO);
    lame_set_VBR(e->lame, vbr_abr);
    lame_set_VBR_mean_bitrate_kbps(e->lame, kbps);
    lame_set_quality(e->lame, 3);
    // The placeholder info frame is only useful if the caller can patch byte 0 at the end.
    lame_set_bWriteVbrTag(e->lame, info_frame);
    if (lame_init_params(e->lame) < 0) {
        lame_close(e->lame);
        free(e);
        return NULL;
    }
    return e;
}

static int reserve_out(encoder *e, int samples) {
    // Worst case per lame.h: 1.25 * samples + 7200.
    int needed = samples + samples / 4 + 7200;
    if (needed <= e->out_capacity) return 1;
    unsigned char *out = realloc(e->out, needed);
    if (!out) return 0;
    e->out = out;
    e->out_capacity = needed;
    return 1;
}

EXPORT("mp3_pcm")
float *mp3_pcm(encoder *e, int channel, int samples) {
    if (channel < 0 || channel >= e->channels) return NULL;
    if (samples > e->pcm_capacity) {
        for (int c = 0; c < e->channels; c++) {
            float *pcm = realloc(e->pcm[c], samples * sizeof(float));
            if (!pcm) return NULL;
            e->pcm[c] = pcm;
        }
        e->pcm_capacity = samples;
    }
    return e->pcm[channel];
}

EXPORT("mp3_out")
unsigned char *mp3_out(encoder *e) { return e->out; }

EXPORT("mp3_encode")
int mp3_encode(encoder *e, int samples) {
    if (samples > e->pcm_capacity || !reserve_out(e, samples)) return -1;
    float *right = e->channels == 2 ? e->pcm[1] : e->pcm[0];
    return lame_encode_buffer_ieee_float(e->lame, e->pcm[0], right, samples, e->out, e->out_capacity);
}

EXPORT("mp3_flush")
int mp3_flush(encoder *e) {
    if (!reserve_out(e, 0)) return -1;
    return lame_encode_flush(e->lame, e->out, e->out_capacity);
}

// Final Xing/LAME info frame; replaces the placeholder frame at the start of the stream.
EXPORT("mp3_info_frame")
int mp3_info_frame(encoder *e) {
    if (!reserve_out(e, 0)) return -1;
    size_t n = lame_get_lametag_frame(e->lame, e->out, e->out_capacity);
    return n > (size_t)e->out_capacity ? -1 : (int)n;
}

EXPORT("mp3_destroy")
void mp3_destroy(encoder *e) {
    lame_close(e->lame);
    arena_reset();
}

// One encoder lives per module instance and everything is released together in mp3_destroy, so a
// bump arena replaces dlmalloc (~11 KB of wasm). Blocks carry their size so realloc can copy.
extern unsigned char __heap_base;
static unsigned char *arena_top;

static void arena_reset(void) { arena_top = &__heap_base; }

void *malloc(size_t n) {
    if (!arena_top) arena_reset();
    size_t total = (n + 16 + 15) & ~(size_t)15;
    size_t end = (size_t)arena_top + total;
    size_t have = (size_t)__builtin_wasm_memory_size(0) * 65536;
    if (end > have && __builtin_wasm_memory_grow(0, (end - have + 65535) / 65536) == (size_t)-1) return NULL;
    unsigned char *block = arena_top;
    arena_top += total;
    *(size_t *)block = n;
    return block + 16;
}

void *calloc(size_t count, size_t size) {
    void *p = malloc(count * size);
    if (p) memset(p, 0, count * size);
    return p;
}

void *realloc(void *p, size_t n) {
    if (!p) return malloc(n);
    size_t old = *(size_t *)((unsigned char *)p - 16);
    if (n <= old) return p;
    void *q = malloc(n);
    if (q) memcpy(q, p, old);
    return q;
}

void free(void *p) {}

// Linked with -Wl,--wrap=<name> (see build.sh). The first group keeps stdio out of the binary; the
// second removes code LAME only dispatches to at runtime for modes this shim never selects
// (CBR/VBR quantizers, ReplayGain, the analyzer's frame info), which the linker could not otherwise
// prove dead. Static functions it cannot reach are removed by lame.patch instead.
void __wrap_lame_report_def(const char *format, va_list ap) {}
int __wrap_id3tag_write_v1(lame_t gfp) { return 0; }
int __wrap_id3tag_write_v2(lame_t gfp) { return 0; }
void __wrap_exit(int status) { __builtin_trap(); }

int __wrap_VBR_encode_frame(void *a, void *b, void *c, void *d) { __builtin_trap(); }
void __wrap_VBR_old_iteration_loop(void *a, void *b, void *c, void *d) { __builtin_trap(); }
void __wrap_VBR_new_iteration_loop(void *a, void *b, void *c, void *d) { __builtin_trap(); }
void __wrap_CBR_iteration_loop(void *a, void *b, void *c, void *d) { __builtin_trap(); }
int __wrap_InitGainAnalysis(void *a, long b) { __builtin_trap(); }
int __wrap_AnalyzeSamples(void *a, const float *l, const float *r, unsigned long n, int c) { __builtin_trap(); }
float __wrap_GetTitleGain(void *a) { __builtin_trap(); }
void __wrap_set_frame_pinfo(void *a, void *b) { __builtin_trap(); }
