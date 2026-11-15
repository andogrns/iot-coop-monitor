#pragma once
#include <stddef.h>
#include <stdint.h>
extern uint32_t fakeMs;
inline uint32_t millis() { return fakeMs; }
inline void delay(uint32_t ms) { fakeMs += ms; }
