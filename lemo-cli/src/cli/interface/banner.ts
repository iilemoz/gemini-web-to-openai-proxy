/**
 * Terminal UI Banner and Formatting
 */

import pc from 'picocolors';

export const CLI_VERSION = '0.1.0';

export function printBanner(): void {
  console.log(pc.bold(pc.cyan(`
  ██╗     ███████╗███╗   ███╗ ██████╗       ██████╗██╗     ██╗
  ██║     ██╔════╝████╗ ████║██╔═══██╗     ██╔════╝██║     ██║
  ██║     █████╗  ██╔████╔██║██║   ██║     ██║     ██║     ██║
  ██║     ██╔══╝  ██║╚██╔╝██║██║   ██║     ██║     ██║     ██║
  ███████╗███████╗██║ ╚═╝ ██║╚██████╔╝     ╚██████╗███████╗██║
  ╚══════╝╚══════╝╚═╝     ╚═╝ ╚═════╝       ╚═════╝╚══════╝╚═╝
  `)));
  console.log(pc.bold(`  Lemo CLI — Standalone Terminal AI Assistant & Coding Agent `) + pc.gray(`(v${CLI_VERSION})`));
  console.log(pc.gray(`  Backend Target: Lemo Universal AI API Backend\n`));
}
