/* Replaces LAME's autotools-generated config.h for the wasm32-wasi build. */
#define STDC_HEADERS 1
#define HAVE_STDINT_H 1
#define HAVE_INTTYPES_H 1
#define HAVE_ERRNO_H 1
#define HAVE_LIMITS_H 1
#define HAVE_STRING_H 1
#define HAVE_STDLIB_H 1
#define LAME_LIBRARY_BUILD 1
#define NOANALYSIS 1
typedef float ieee754_float32_t;
typedef double ieee754_float64_t;
typedef long double ieee854_float80_t;

/* libm is ~25 KB of wasm; JS Math is free. machine.h includes this header before <math.h>. */
#include <math.h>
#define JS_MATH(name) __attribute__((import_module("env"), import_name(#name)))
double js_pow(double, double) JS_MATH(pow);
float js_powf(float, float) JS_MATH(powf);
double js_exp(double) JS_MATH(exp);
double js_log(double) JS_MATH(log);
double js_log10(double) JS_MATH(log10);
float js_log10f(float) JS_MATH(log10f);
double js_sin(double) JS_MATH(sin);
double js_cos(double) JS_MATH(cos);
double js_atan(double) JS_MATH(atan);
#define pow js_pow
#define powf js_powf
#define exp js_exp
#define log js_log
#define log10 js_log10
#define log10f js_log10f
#define sin js_sin
#define cos js_cos
#define atan js_atan
