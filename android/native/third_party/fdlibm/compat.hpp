#pragma once
#include <cstdint>
#include <cstring>
#include <type_traits>
#define V8_BASE_EXPORT
#define V8_INLINE inline
#define V8_WARN_UNUSED_RESULT
#define V8_CC_MSVC 0
namespace v8 { namespace base {
template<class To,class From> inline To bit_cast(const From& value){static_assert(sizeof(To)==sizeof(From));To result;std::memcpy(&result,&value,sizeof(result));return result;}
inline double Divide(double a,double b){return a/b;}
template<class T> inline T NegateWithWraparound(T value){using U=std::make_unsigned_t<T>;U result=U(0)-static_cast<U>(value);return bit_cast<T>(result);}
template<class T,class B> inline T SubWithWraparound(T a,B b){using U=std::make_unsigned_t<T>;U result=static_cast<U>(a)-static_cast<U>(b);return bit_cast<T>(result);}
}}
