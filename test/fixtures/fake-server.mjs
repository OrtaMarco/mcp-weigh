// A fake stdio MCP server for tests. Behaviour is driven by flags:
//   --tools=N        expose N tools named <prefix>_tool_<i>
//   --prefix=x       tool name prefix (default "fake")
//   --desc=TEXT      description used for every generated tool
//   --named=a:desc,b:desc   expose extra tools with explicit names and descriptions
//   --long=CHARS     make the first tool's description CHARS characters long
//   --prompts=N      expose N prompts
//   --page=SIZE      paginate tools/list with this page size
//   --empty          declare no capabilities (no tools/prompts/resources)
//   --hang          accept the process but never answer (timeout tests)
//   --crash          write a secret-looking string to stderr and exit 1
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListPromptsRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const flags = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split(/=(.*)/s);
    return [k, v ?? true];
  }),
);

if (flags.crash) {
  process.stderr.write(`boot failed, token=${process.env.FAKE_SECRET ?? "none"}\n`);
  process.exit(1);
}
if (flags.hang) {
  setInterval(() => {}, 1000);
} else {
  const prefix = flags.prefix ?? "fake";
  const count = Number(flags.tools ?? 3);
  const prompts = Number(flags.prompts ?? 0);
  const baseDesc = flags.desc ?? "Does a thing with the given input and returns the result.";

  const tools = Array.from({ length: count }, (_, i) => ({
    name: `${prefix}_tool_${i}`,
    description: baseDesc,
    inputSchema: { type: "object", properties: { input: { type: "string", description: "Input value" } }, required: ["input"] },
  }));
  for (const spec of String(flags.named ?? "").split(",").filter(Boolean)) {
    const [name, ...desc] = spec.split(":");
    tools.push({ name, description: desc.join(":"), inputSchema: { type: "object", properties: {} } });
  }
  if (flags.long && tools[0]) tools[0].description = "x".repeat(Number(flags.long));

  // --empty: a server that declares no capabilities at all.
  const capabilities = flags.empty ? {} : { tools: {}, ...(prompts ? { prompts: {} } : {}) };
  const server = new Server({ name: "fake-server", version: "1.0.0" }, { capabilities });

  if (capabilities.tools) {
    server.setRequestHandler(ListToolsRequestSchema, async (req) => {
      const size = Number(flags.page ?? 0);
      if (!size) return { tools };
      const start = Number(req.params?.cursor ?? 0);
      const next = start + size;
      return { tools: tools.slice(start, next), nextCursor: next < tools.length ? String(next) : undefined };
    });
  }
  if (capabilities.prompts) {
    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: Array.from({ length: prompts }, (_, i) => ({ name: `${prefix}_prompt_${i}`, description: "A prompt." })),
    }));
  }

  await server.connect(new StdioServerTransport());
}
