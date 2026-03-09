// NOTE(dkorolev): There will be more to this module.
// For now it's just the prompt to connect `xmemory` to Mastra.

function greet(name) {
  if (name) {
    return `Hello, ${name}!`;
  }
  return "Hello, xmemory!";
}

module.exports = greet;
