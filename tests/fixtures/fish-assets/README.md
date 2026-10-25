# Test images only

`transparent-test.png` is an original synthetic 40×64 RGBA pattern, generated
with Python's `struct`/`zlib` (filter 0, uncompressed deflate). It contains clear,
half-alpha and opaque columns. It is over Vite's default inline threshold so the
test also checks an emitted `/barb/assets/…png` URL. No third-party art or license
is involved. This is not a production fish or a proposed Phase 4C-1 art size.

`transparent-test.svg` is an original synthetic 640×280 side-view fish used
only for explicit SVG format/UI/Vite compatibility after production moved to
PNG. It is separate from the removed placeholder artwork and is never shipped.
