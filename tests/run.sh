#!/bin/sh
# تشغيل كل الاختبارات النقية (من جذر المشروع): sh tests/run.sh
set -e
for t in tests/*.test.mjs; do npx esbuild "$t" --bundle --platform=node --format=esm --log-level=error | node --input-type=module; done
