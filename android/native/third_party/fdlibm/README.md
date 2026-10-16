# Deterministic elementary mathematics

`ieee754.cpp` and `ieee754.h` originate from V8 tag **13.6.233**:
https://github.com/v8/v8/tree/13.6.233/src/base

The original Sun/fdlibm notices are retained in the source; V8's BSD license is
included in `LICENSE`. Only engine-specific include paths were replaced with the
small `compat.hpp` shim. No JavaScript engine or browser is embedded.

The native simulation uses these implementations for trigonometric functions so
Windows and ARM64 do not silently select different system math routines near
tire-slip and gearbox branch thresholds. Compile without floating-point
contraction or fast-math. Reference fixtures are still required to detect drift.
