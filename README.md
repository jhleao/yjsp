# yjsp

This is the most barebones yjs implementation I could get together. It's just a plain HTML textarea with basic input handling. Kinda buggy, but gets the advanced editors out of the way to experiment with the pure yjs websocket protocol.

## Running

Install yarn with `npm i -g yarn`, install deps with `yarn` and run the app with

```
yarn dev
```

Server will run on `ws://localhost:1234` and client on `http://localhost:3000` by default.

## Branches

- `tiptap`: basic TipTap + yjs setup, without the [hocuspocus](https://tiptap.dev/guide/collaborative-editing) backend. Optionally uses y-redis for persistence (`REDIS_URI` env var)
