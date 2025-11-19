#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { createCommand } from "./commands/create.js";

const program = new Command();

program.name("openintent").description("OIML CLI for managing OIML projects").version("0.1.0");

program
  .command("init")
  .description("Initialize a new OIML project in the current directory")
  .option("-y, --yes", "Skip prompts and use defaults")
  .action(async options => {
    await initCommand(options);
  });

program
  .command("create")
  .description("Create a new intent file in .oiml/intents/")
  .argument("[name]", "Name of the intent (e.g. 'INT-1')")
  .action(async name => {
    await createCommand(name);
  });

program.parse();
