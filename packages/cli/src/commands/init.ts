import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import * as YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ProjectConfig {
  name: string;
  description: string;
  version: string;
  framework: string;
  language: string;
  provider?: {
    name: string;
    region: string;
  };
  database?: {
    type: string;
    schema: string;
    connection: string;
  };
  auth?: {
    provider: string;
    adapter?: string;
    sessionStrategy?: string;
  };
  paths?: {
    api?: string;
    components?: string;
    entities?: string;
    utils?: string;
    types?: string;
    tests?: string;
  };
  ui?: {
    base_components?: Array<{ [key: string]: string }>;
    theme?: {
      primary_color?: string;
      accent_color?: string;
      border_radius?: string;
    };
  };
  intents?: {
    directory: string;
    schema_version: number;
    default_review_policy: string;
  };
  metadata?: {
    maintainers?: Array<{ name: string; email?: string }>;
    license?: string;
    repository?: string;
  };
}

async function detectProjectType(): Promise<Partial<ProjectConfig>> {
  const packageJsonPath = resolve(process.cwd(), 'package.json');
  let framework = 'unknown';
  let language = 'typescript';
  
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      
      // Detect framework
      if (packageJson.dependencies?.next || packageJson.devDependencies?.next) {
        framework = 'nextjs';
      } else if (packageJson.dependencies?.express || packageJson.devDependencies?.express) {
        framework = 'express';
      } else if (packageJson.dependencies?.fastify || packageJson.devDependencies?.fastify) {
        framework = 'fastify';
      }
      
      // Detect language
      if (existsSync(resolve(process.cwd(), 'tsconfig.json'))) {
        language = 'typescript';
      } else if (packageJson.type === 'module') {
        language = 'javascript';
      } else {
        language = 'javascript';
      }
      
      // Detect database
      let database: ProjectConfig['database'] | undefined;
      if (packageJson.dependencies?.prisma || packageJson.devDependencies?.prisma) {
        if (existsSync(resolve(process.cwd(), 'prisma', 'schema.prisma'))) {
          database = {
            type: 'postgres',
            schema: 'prisma/schema.prisma',
            connection: 'env:DATABASE_URL'
          };
        }
      }
    } catch (error) {
      // Ignore errors in package.json parsing
    }
  }
  
  return {
    framework,
    language,
  };
}

async function promptForProjectDetails(
  detected: Partial<ProjectConfig>,
  skipPrompts: boolean
): Promise<ProjectConfig> {
  const packageJsonPath = resolve(process.cwd(), 'package.json');
  let defaultName = 'MyProject';
  let defaultDescription = 'An OpenIntent project';
  
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      defaultName = packageJson.name || defaultName;
      defaultDescription = packageJson.description || defaultDescription;
    } catch (error) {
      // Ignore errors
    }
  }
  
  if (skipPrompts) {
    return {
      name: defaultName,
      description: defaultDescription,
      version: '0.1.0',
      framework: detected.framework || 'nextjs',
      language: detected.language || 'typescript',
      database: detected.database,
      intents: {
        directory: '.openintent/intents',
        schema_version: 1.0,
        default_review_policy: 'auto'
      }
    };
  }
  
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Project name:',
      default: defaultName
    },
    {
      type: 'input',
      name: 'description',
      message: 'Project description:',
      default: defaultDescription
    },
    {
      type: 'list',
      name: 'framework',
      message: 'Framework:',
      choices: ['nextjs', 'express', 'fastify', 'other'],
      default: detected.framework || 'nextjs'
    },
    {
      type: 'list',
      name: 'language',
      message: 'Language:',
      choices: ['typescript', 'javascript'],
      default: detected.language || 'typescript'
    }
  ]);
  
  return {
    name: answers.name,
    description: answers.description,
    version: '0.1.0',
    framework: answers.framework,
    language: answers.language,
    database: detected.database,
    intents: {
      directory: '.openintent/intents',
      schema_version: 1.0,
      default_review_policy: 'auto'
    }
  };
}

function generateProjectYaml(config: ProjectConfig): string {
  const yamlObj: any = {
    name: config.name,
    description: config.description,
    version: config.version,
    framework: config.framework,
    language: config.language,
  };
  
  if (config.provider) {
    yamlObj.provider = config.provider;
  }
  
  if (config.database) {
    yamlObj.database = config.database;
  }
  
  if (config.auth) {
    yamlObj.auth = config.auth;
  }
  
  if (config.paths) {
    yamlObj.paths = config.paths;
  }
  
  if (config.ui) {
    yamlObj.ui = config.ui;
  }
  
  if (config.intents) {
    yamlObj.intents = config.intents;
  }
  
  if (config.metadata) {
    yamlObj.metadata = config.metadata;
  }
  
  return YAML.stringify(yamlObj);
}

export async function initCommand(options: { yes?: boolean }) {
  const cwd = process.cwd();
  const openintentDir = join(cwd, '.openintent');
  const intentsDir = join(openintentDir, 'intents');
  const projectYamlPath = join(openintentDir, 'project.yaml');
  
  // Check if .openintent already exists
  if (existsSync(openintentDir)) {
    console.log(chalk.yellow('⚠️  .openintent directory already exists'));
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: 'Do you want to overwrite the existing project.yaml?',
        default: false
      }
    ]);
    
    if (!overwrite) {
      console.log(chalk.gray('Cancelled.'));
      process.exit(0);
    }
  } else {
    // Create .openintent directory
    mkdirSync(openintentDir, { recursive: true });
    console.log(chalk.green('✓ Created .openintent directory'));
  }
  
  // Detect project type
  const detected = await detectProjectType();
  console.log(chalk.blue('🔍 Detected project type:'), detected.framework || 'unknown');
  
  // Prompt for project details
  const config = await promptForProjectDetails(detected, options.yes || false);
  
  // Generate project.yaml
  const projectYaml = generateProjectYaml(config);
  writeFileSync(projectYamlPath, projectYaml, 'utf-8');
  console.log(chalk.green('✓ Created project.yaml'));
  
  // Create intents directory
  if (!existsSync(intentsDir)) {
    mkdirSync(intentsDir, { recursive: true });
    // Create .gitkeep to ensure the directory is tracked
    writeFileSync(join(intentsDir, '.gitkeep'), '', 'utf-8');
    console.log(chalk.green('✓ Created intents directory'));
  }
  
  // Copy OPENINTENT.md template if it exists
  // Try multiple possible locations (development vs built package)
  const possibleTemplatePaths = [
    join(__dirname, '../../templates/OPENINTENT.md'), // Built package
    join(__dirname, '../templates/OPENINTENT.md'), // Alternative location
    join(process.cwd(), 'node_modules/@openintent/cli/templates/OPENINTENT.md'), // npm package
  ];
  
  let templatePath: string | null = null;
  for (const path of possibleTemplatePaths) {
    if (existsSync(path)) {
      templatePath = path;
      break;
    }
  }
  
  if (templatePath) {
    const template = readFileSync(templatePath, 'utf-8');
    const openintentMdPath = join(openintentDir, 'OPENINTENT.md');
    writeFileSync(openintentMdPath, template, 'utf-8');
    console.log(chalk.green('✓ Created OPENINTENT.md'));
  }
  
  console.log(chalk.green('\n✨ OpenIntent project initialized successfully!'));
  console.log(chalk.gray('\nNext steps:'));
  console.log(chalk.gray('  - Create intent files in .openintent/intents/'));
  console.log(chalk.gray('  - Customize .openintent/project.yaml'));
}

