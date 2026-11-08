#!/bin/sh
# Health check script for both MCP and Linear servers

check_server() {
  url=$1
  name=$2
  
  # Use wget if available, otherwise use node
  if command -v wget >/dev/null 2>&1; then
    wget --quiet --tries=1 --timeout=5 --spider "$url" >/dev/null 2>&1
    return $?
  else
    # Fallback to node
    node -e "
      const http = require('http');
      const req = http.get('$url', (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          process.exit(res.statusCode === 200 ? 0 : 1);
        });
      });
      req.on('error', () => process.exit(1));
      req.setTimeout(5000, () => {
        req.destroy();
        process.exit(1);
      });
    " >/dev/null 2>&1
    return $?
  fi
}

# Check both servers
MCP_OK=0

if check_server "http://localhost:3111/health" "MCP"; then
  MCP_OK=1
fi

# Both must be healthy
if [ $MCP_OK -eq 1 ]; then
  exit 0
else
  echo "Health check failed: MCP=$MCP_OK" >&2
  exit 1
fi



