# @proj-airi/airi-mcp-server

An MCP server that lets an agent, such as Claude Code, control the running AIRI desktop app (stage-tamagotchi).

## What it does

It connects to the channel server of the app (`ws://127.0.0.1:6121/ws`) as the module `avatar:claude-code`. It offers two kinds of tools.

Static tools. They answer when the app is down.

| Tool | What it does |
| --- | --- |
| `airi_get_status` | Tells whether the app answers, where its user data and newest log are, and which stage tools it offers. |
| `airi_get_logs` | Returns the last lines of the newest app log, with an optional text filter. |
| `airi_send_message` | Sends a chat message as the user and returns the reply text. |

Stage tools. The app owns them. They are the settings tools that the character calls in a chat turn, with the prefix `airi_`, for example `airi_settings_get`, `airi_set_voice`, `airi_set_display_model`, and `airi_expression_set`. The app sends their schemas and validates the arguments.

The stage tools go through the protocol events `tool:list:request` and `tool:invoke:request`. Only the leader window of the app answers them.

## How to use it

Start the app first. Then run the server on stdio:

```sh
pnpm -F @proj-airi/airi-mcp-server start
```

For an MCP client, call `tsx` directly. `pnpm` writes its own lines to stdout, and stdout carries the protocol:

```json
{
  "mcpServers": {
    "airi": {
      "command": "<airi>/node_modules/.bin/tsx",
      "args": ["<airi>/services/airi-mcp-server/src/bin/run.ts"]
    }
  }
}
```

Environment variables:

- `AIRI_CHANNEL_URL`: the channel URL. Default `ws://127.0.0.1:${SERVER_CHANNEL_PORT ?? 6121}/ws`.
- `APP_USER_DATA_PATH`: the user data directory of the app, the same override as the app uses.

To inspect the tools, run `pnpm -F @proj-airi/airi-mcp-server mcp:inspector`.

## When to use it

- Use it to read or change settings, the avatar, the voice, and expressions from an agent, and to test replies.
- Do not use it to change provider API keys. The tools do not read or write credentials.

## Notes

- If the app starts after the client lists the tools, only the static tools show. The server sends `notifications/tools/list_changed` when it reaches the app. If your client ignores that notification, reconnect the server, for example with `/mcp` in Claude Code.
- `airi_send_message` takes the first finished reply after the send as the answer. The stage does not tag a reply with its input.
- Security: the server reads the channel token from `server-channel-config.json` in the user data directory. Any process that can read that file can change settings through the channel.
- `evaluation.xml` holds read-only test questions. Their answers are a snapshot of one setup.
