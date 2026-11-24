const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m'
};

function timestamp() {
  return new Date().toISOString().substring(11, 19);
}

export const logger = {
  info(message, ...args) {
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.cyan}INFO${colors.reset}  ${message}`, ...args);
  },
  success(message, ...args) {
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.green}PASS${colors.reset}  ${message}`, ...args);
  },
  warn(message, ...args) {
    console.warn(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.yellow}WARN${colors.reset}  ${message}`, ...args);
  },
  error(message, ...args) {
    console.error(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.red}ERR!${colors.reset}  ${message}`, ...args);
  },
  debug(message, ...args) {
    if (process.env.DEBUG === 'true') {
      console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.magenta}DBUG${colors.reset}  ${message}`, ...args);
    }
  }
};
