"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  FolderOpenIcon,
  FileTextIcon,
  CheckCircle,
  Bot,
  MoreVertical,
  Trash2,
  Code,
  Settings,
  X,
  Plus,
  Zap,
  ListChecks,
  FileCheck,
  AlertCircle,
  RotateCcw
} from "lucide-react";
import type { ElectronAPI } from "@/types/electron";
import * as yaml from "js-yaml";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem
} from "@/components/ui/dropdown-menu";
import { useTheme } from "next-themes";
import { Input } from "@/components/ui/input";
import { IntentHumanView } from "@/components/IntentHumanView";
import { IntentBuilder, type Intent } from "@/components/IntentBuilder";
import { LinearIssueView } from "@/components/LinearIssueView";
import { toast } from "sonner";

// Model to icon mapping
const getModelIcon = (model: string) => {
  const modelLower = model.toLowerCase();

  if (modelLower.includes("claude")) {
    return <Image src="/claude.png" alt="Claude" width={16} height={16} className="w-4 h-4" />;
  }

  // Add more model mappings here as needed
  // if (modelLower.includes("gpt")) {
  //   return <OpenAIIcon className="w-4 h-4" />;
  // }

  // Default icon for unknown models
  return <Bot className="w-4 h-4" />;
};

// Framework logo component - returns the logo component or null
const getFrameworkLogoComponent = (framework: string, category: "api" | "database" | "ui"): React.ReactNode | null => {
  const frameworkLower = framework.toLowerCase();

  // Use Next.js logo for Next.js framework
  if (frameworkLower === "next") {
    return <Image src="/next.svg" alt="Next.js" width={24} height={24} className="w-6 h-6" />;
  }

  // Use Prisma logo for database framework
  if (category === "database" && frameworkLower === "prisma") {
    return <Image src="/prisma.svg" alt={framework} width={24} height={24} className="w-6 h-6" />;
  }

  // Default fallback
  return null;
};

interface ProjectConfig {
  name?: string;
  description?: string;
  version?: string;
  api?: {
    framework?: string;
    language?: string;
  };
  database?: {
    type?: string;
    framework?: string;
    schema?: string;
  };
  ui?: {
    framework?: string;
    language?: string;
  };
  intents?: {
    directory?: string;
  };
}

interface IntentInfo {
  id: string;
  path: string;
  hasIntent: boolean;
  hasPlan: boolean;
  hasSummary: boolean;
  intentData?: Intent[];
  planData?: any;
  summaryData?: any;
  intentYamlContent?: string; // Store raw YAML content for validation
  validationErrors?: string[]; // Store validation errors
}

// Linear icon component that switches based on theme
function LinearIcon({ className }: { className?: string }) {
  const { theme, resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark" || (resolvedTheme === undefined && theme === "dark");

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill={isDark ? "#fff" : "#222326"}
      width="16"
      height="16"
      viewBox="0 0 100 100"
      className={className}
    >
      <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3075.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99132 1.6684-1.88843 3.3994-2.68399 5.1855ZM12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3903.3487-.984.3258-1.3542-.0443L12.6587 18.074Z" />
    </svg>
  );
}

export default function Home() {
  const { theme, setTheme } = useTheme();
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedIntent, setSelectedIntent] = useState<IntentInfo | null>(null);
  // Use a ref to track the current selected intent ID so it's always current in closures
  const selectedIntentIdRef = useRef<string | null>(null);
  // Use a ref to track the current selected intent path so it's always current in closures
  const selectedIntentPathRef = useRef<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("intent");
  const [isElectron, setIsElectron] = useState(false);
  const [isAddIntentDialogOpen, setIsAddIntentDialogOpen] = useState(false);
  const [isIntentYamlDialogOpen, setIsIntentYamlDialogOpen] = useState(false);
  const [isProjectSettingsYamlDialogOpen, setIsProjectSettingsYamlDialogOpen] = useState(false);
  const [isEditIntentsDialogOpen, setIsEditIntentsDialogOpen] = useState(false);
  const [newIntentName, setNewIntentName] = useState("");
  const [builderIntents, setBuilderIntents] = useState<Intent[]>([]);
  const [editIntents, setEditIntents] = useState<Intent[]>([]);
  const [contextMenuIntentId, setContextMenuIntentId] = useState<string | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [projectConfig, setProjectConfig] = useState<ProjectConfig | null>(null);
  const [intents, setIntents] = useState<IntentInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editedYaml, setEditedYaml] = useState<string>("");
  const [projectYaml, setProjectYaml] = useState<string>("");
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [isProjectSettingsDialogOpen, setIsProjectSettingsDialogOpen] = useState(false);
  const [linearAccessToken, setLinearAccessToken] = useState<string>("");
  const [isSavingLinearToken, setIsSavingLinearToken] = useState(false);
  const [openaiApiKey, setOpenaiApiKey] = useState<string>("");
  const [isSavingOpenAIKey, setIsSavingOpenAIKey] = useState(false);
  const isCreatingIntentRef = useRef(false);

  const getElectronAPI = (): ElectronAPI | undefined => {
    if (typeof window === "undefined") return undefined;
    return window.electronAPI;
  };

  // Validate intent against OIML schema using @oiml/schema package
  const validateIntent = async (yamlContent: string): Promise<{ valid: boolean; errors?: string[] }> => {
    try {
      // Parse YAML first to get the version
      const parsed = yaml.load(yamlContent);
      if (!parsed || typeof parsed !== "object") {
        return { valid: false, errors: ["Invalid YAML structure"] };
      }

      const parsedObj = parsed as Record<string, unknown>;
      const version = parsedObj.version as string | undefined;

      if (!version) {
        return { valid: false, errors: ["Missing required field: version"] };
      }

      // Dynamically import the schema based on version
      // For now, we support 0.1.0. In the future, we can extend this to support multiple versions
      let IntentSchema;
      try {
        if (version === "0.1.0") {
          // Import the Intent schema from @oiml/schema package
          const schemaModule = await import("@oiml/schema/schemas/oiml.intent/0.1.0/schema.zod.js");
          IntentSchema = schemaModule.Intent;
        } else {
          return {
            valid: false,
            errors: [`Unsupported schema version: ${version}. Currently only version 0.1.0 is supported.`]
          };
        }
      } catch (importErr) {
        console.error("Error importing schema:", importErr);
        return {
          valid: false,
          errors: [
            `Failed to load schema for version ${version}: ${importErr instanceof Error ? importErr.message : String(importErr)}`
          ]
        };
      }

      // Validate using Zod schema
      const result = IntentSchema.safeParse(parsedObj);

      if (result.success) {
        return { valid: true };
      } else {
        // Format Zod errors into readable messages
        const errors = result.error.errors.map(err => {
          const path = err.path.join(".");
          return `${path}: ${err.message}`;
        });
        return { valid: false, errors };
      }
    } catch (err) {
      return { valid: false, errors: [`Validation error: ${err instanceof Error ? err.message : String(err)}`] };
    }
  };

  // Wrapper function to update both state and ref
  const updateSelectedIntent = (intent: IntentInfo | null) => {
    setSelectedIntent(intent);
    selectedIntentIdRef.current = intent?.id || null;
    selectedIntentPathRef.current = intent?.path || null;
  };

  // Check if running in Electron
  useEffect(() => {
    const checkElectron = () => {
      const isElectronEnv = typeof window !== "undefined" && window.electronAPI !== undefined;
      setIsElectron(isElectronEnv);
    };
    checkElectron();
  }, []);

  // Load saved folder and recent projects on mount
  useEffect(() => {
    if (!isElectron) {
      setIsInitializing(false);
      return;
    }

    const initializeApp = async () => {
      try {
        const electronAPI = getElectronAPI();
        if (!electronAPI) return;

        // Load saved folder
        const savedFolder = await electronAPI.loadSelectedFolder?.();
        if (savedFolder) {
          setSelectedFolder(savedFolder);
          await loadOIMLData(savedFolder);
        }

        // Load recent projects
        const recentResult = await electronAPI.getRecentProjects?.();
        if (recentResult?.success && recentResult.projects) {
          setRecentProjects(recentResult.projects);
        }
      } catch (error) {
        console.error("Error initializing app:", error);
      } finally {
        setIsInitializing(false);
      }
    };

    initializeApp();
  }, [isElectron]);

  // Update edited YAML when intent changes or dialog opens
  useEffect(() => {
    if (selectedIntent?.intentData && isIntentYamlDialogOpen) {
      const newYaml = yaml.dump(selectedIntent.intentData, {
        indent: 2,
        lineWidth: -1
      });

      setEditedYaml(newYaml);
    }
  }, [selectedIntent?.intentData, isIntentYamlDialogOpen]);

  // Update project YAML when project config changes or dialog opens
  useEffect(() => {
    if (projectConfig && isProjectSettingsYamlDialogOpen) {
      const newYaml = yaml.dump(projectConfig, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        sortKeys: false
      });
      setProjectYaml(newYaml);
    }
  }, [projectConfig, isProjectSettingsYamlDialogOpen]);

  // Load OpenAI API key when project settings view is shown
  useEffect(() => {
    if (isElectron) {
      const loadAPIKeys = async () => {
        const electronAPI = getElectronAPI();
        if (!electronAPI) return;

        try {
          const result = await electronAPI.getOpenAIApiKey?.();
          if (result?.success && result.apiKey) {
            setOpenaiApiKey(result.apiKey);
          } else {
            setOpenaiApiKey("");
          }
        } catch (error) {
          console.error("Error loading OpenAI API key:", error);
          setOpenaiApiKey("");
        }

        try {
          const result = await electronAPI.getLinearAccessToken?.();
          if (result?.success && result.token) {
            setLinearAccessToken(result.token);
          } else {
            setLinearAccessToken("");
          }
        } catch (error) {
          console.error("Error loading Linear access token:", error);
          setLinearAccessToken("");
        }
      };

      loadAPIKeys();
    }
  }, [isElectron]);

  // Set up file watching when folder is selected
  useEffect(() => {
    const electronAPI = getElectronAPI();
    if (!electronAPI || !selectedFolder) {
      return;
    }

    // Set up listener for file changes BEFORE starting to watch
    const handleFileChanged = async (data: { event: string; path: string; folderPath: string }) => {
      // Ignore file changes during intent creation
      if (isCreatingIntentRef.current) {
        return;
      }

      // Check if project.yaml was changed - check for both forward and backslash paths
      const normalizedPath = data.path.replace(/\\/g, "/");
      const isProjectYamlChange =
        normalizedPath.includes("/.oiml/project.yaml") ||
        normalizedPath.endsWith("/project.yaml") ||
        normalizedPath.endsWith("project.yaml");

      // Debug log to see what files are being watched
      if (isProjectYamlChange) {
        console.log("[FileWatcher] project.yaml changed:", data.path, "event:", data.event);
      }

      // If a directory was deleted and it matches the selected intent, clear the selection
      if (data.event === "unlinkDir") {
        // Extract intent ID from path (e.g., "/path/to/.oiml/intents/INTENT-1" -> "INTENT-1")
        const pathParts = data.path.split(/[/\\]/);
        const intentsIndex = pathParts.findIndex(part => part === "intents");
        if (intentsIndex >= 0 && intentsIndex < pathParts.length - 1) {
          const deletedIntentId = pathParts[intentsIndex + 1];
          // Compare with selected intent ID using ref (always current, not stale)
          if (selectedIntentIdRef.current === deletedIntentId) {
            // Clear the selected intent state
            updateSelectedIntent(null);
          }
        }
      }

      // Reload OIML data when files or directories change
      // Use the folderPath from the event data to ensure we're watching the right folder
      const folderToReload = data.folderPath || selectedFolder;

      // Use a delay to ensure file/directory operations are complete
      // Directory operations (addDir/unlinkDir) may need slightly more time
      // Project.yaml changes may need a slightly longer delay to ensure the file is fully written
      const delay = data.event === "addDir" || data.event === "unlinkDir" ? 500 : isProjectYamlChange ? 300 : 300;

      setTimeout(async () => {
        await loadOIMLData(folderToReload);
      }, delay);
    };

    const removeListener = electronAPI.onFileChanged?.(handleFileChanged);

    // Start watching the folder AFTER setting up the listener
    electronAPI.watchFolder?.(selectedFolder).catch(error => {
      console.error("Error starting file watcher:", error);
    });

    // Cleanup: stop watching and remove listener when folder changes or component unmounts
    return () => {
      if (removeListener && typeof removeListener === "function") {
        removeListener();
      } else {
        electronAPI.removeFileChangedListener?.();
      }
      electronAPI.stopWatching?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFolder]);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenuIntentId(null);
      setContextMenuPosition(null);
    };

    if (contextMenuIntentId) {
      document.addEventListener("click", handleClickOutside);
      return () => {
        document.removeEventListener("click", handleClickOutside);
      };
    }
  }, [contextMenuIntentId]);

  const handleSelectFolder = async () => {
    const electronAPI = getElectronAPI();
    if (!electronAPI) {
      setError("Electron API not available. Please run this app in Electron.");
      return;
    }

    try {
      const result = await electronAPI.selectFolder();
      if (result.canceled === false && result.filePaths?.length > 0) {
        const folderPath = result.filePaths[0];
        await handleOpenProject(folderPath);
      }
    } catch (err) {
      setError(`Error selecting folder: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleSaveLinearToken = async () => {
    const electronAPI = getElectronAPI();
    if (!electronAPI) {
      setError("Electron API not available. Please run this app in Electron.");
      return;
    }

    setIsSavingLinearToken(true);
    try {
      const result = await electronAPI.saveLinearAccessToken?.(linearAccessToken);
      if (result?.success) {
        // Reload token to ensure state is updated (this will show/hide the Linear tab)
        const tokenResult = await electronAPI.getLinearAccessToken?.();
        if (tokenResult?.success) {
          setLinearAccessToken(tokenResult.token || "");
        }
        toast.success("Linear API key saved");
      } else {
        const errorMsg = result?.error || "Failed to save Linear access token";
        setError(errorMsg);
        toast.error(errorMsg);
      }
    } catch (err) {
      setError(`Error saving Linear access token: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsSavingLinearToken(false);
    }
  };

  const handleRemoveLinearToken = async () => {
    const electronAPI = getElectronAPI();
    if (!electronAPI) {
      setError("Electron API not available. Please run this app in Electron.");
      return;
    }

    setIsSavingLinearToken(true);
    try {
      // Save empty string to clear the token
      const result = await electronAPI.saveLinearAccessToken?.("");
      if (result?.success) {
        // Clear the token from state
        setLinearAccessToken("");
        // Reload token to ensure state is updated (this will hide the Linear tab)
        const tokenResult = await electronAPI.getLinearAccessToken?.();
        if (tokenResult?.success) {
          setLinearAccessToken(tokenResult.token || "");
        }
        toast.success("Linear API key removed");
      } else {
        const errorMsg = result?.error || "Failed to remove Linear access token";
        setError(errorMsg);
        toast.error(errorMsg);
      }
    } catch (err) {
      setError(`Error removing Linear access token: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsSavingLinearToken(false);
    }
  };

  const handleSaveOpenAIKey = async () => {
    const electronAPI = getElectronAPI();
    if (!electronAPI) {
      setError("Electron API not available. Please run this app in Electron.");
      return;
    }

    setIsSavingOpenAIKey(true);
    try {
      const result = await electronAPI.saveOpenAIApiKey?.(openaiApiKey);
      if (result?.success) {
        // Reload key to ensure state is updated
        const keyResult = await electronAPI.getOpenAIApiKey?.();
        if (keyResult?.success) {
          setOpenaiApiKey(keyResult.apiKey || "");
        }
        toast.success("OpenAI API key saved");
      } else {
        const errorMsg = result?.error || "Failed to save OpenAI API key";
        setError(errorMsg);
        toast.error(errorMsg);
      }
    } catch (err) {
      setError(`Error saving OpenAI API key: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsSavingOpenAIKey(false);
    }
  };

  const handleRemoveOpenAIKey = async () => {
    const electronAPI = getElectronAPI();
    if (!electronAPI) {
      setError("Electron API not available. Please run this app in Electron.");
      return;
    }

    setIsSavingOpenAIKey(true);
    try {
      // Delete the key from store
      const result = await electronAPI.saveOpenAIApiKey?.("");
      if (result?.success) {
        // Clear the input field - don't reload to avoid repopulating with env var
        // The env var will still be used for API calls, but the UI shows empty
        setOpenaiApiKey("");
        toast.success("OpenAI API key removed");
      } else {
        const errorMsg = result?.error || "Failed to remove OpenAI API key";
        setError(errorMsg);
        toast.error(errorMsg);
      }
    } catch (err) {
      console.error("Error removing OpenAI API key:", err);
      setError(`Error removing OpenAI API key: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsSavingOpenAIKey(false);
    }
  };

  const handleOpenProject = async (folderPath: string) => {
    const electronAPI = getElectronAPI();
    if (!electronAPI) return;

    try {
      setSelectedFolder(folderPath);
      updateSelectedIntent(null);
      setError(null);

      // Save the selected folder
      try {
        await electronAPI.saveSelectedFolder(folderPath);
      } catch (saveError) {
        console.error("Error saving selected folder:", saveError);
      }

      // Add to recent projects
      try {
        await electronAPI.addRecentProject?.(folderPath);
        // Refresh recent projects list
        const recentResult = await electronAPI.getRecentProjects?.();
        if (recentResult?.success && recentResult.projects) {
          setRecentProjects(recentResult.projects);
        }
      } catch (recentError) {
        console.error("Error adding recent project:", recentError);
      }

      await loadOIMLData(folderPath);
    } catch (err) {
      setError(`Error opening project: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleClearFolder = async () => {
    const electronAPI = getElectronAPI();
    if (!electronAPI) return;

    try {
      // Clear saved folder
      await electronAPI.saveSelectedFolder("");
      setSelectedFolder(null);
      updateSelectedIntent(null);
      setProjectConfig(null);
      setIntents([]);
      setError(null);
    } catch (err) {
      console.error("Error clearing folder:", err);
    }
  };

  const handleInitializeOIML = async () => {
    if (!selectedFolder) return;

    const electronAPI = getElectronAPI();
    if (!electronAPI) {
      setError("Electron API not available.");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const result = await electronAPI.runCommand?.("oiml init -y", selectedFolder);

      if (result?.success) {
        // Reload OIML data after initialization
        await loadOIMLData(selectedFolder);
      } else {
        setError(result?.error || "Failed to initialize OIML project");
        setIsLoading(false);
      }
    } catch (err) {
      setError(`Error initializing OIML: ${err instanceof Error ? err.message : "Unknown error"}`);
      setIsLoading(false);
    }
  };

  const sanitizeFileName = (name: string): string => {
    // Remove invalid characters and replace spaces with hyphens
    return name
      .replace(/[^a-zA-Z0-9-_]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toUpperCase();
  };

  const generateIntentTemplate = (name: string, version: string, intents: Intent[] = []): string => {
    const yamlObj = {
      version: version,
      type: "oiml.intent",
      ai_context: {
        purpose: "Conform to project frameworks, style, and conventions.",
        instructions:
          "- CRITICAL: Call the MCP tool `get_agents_guide` FIRST before proceeding to retrieve the OIML Agents implementation guide and apply the instructions to the intent.",
        references: [
          {
            kind: "mcp_tool",
            tool: "get_agents_guide",
            description:
              "OIML Agents implementation guide containing workflow instructions, framework-specific patterns, and best practices"
          }
        ]
      },
      provenance: {
        created_by: {
          type: "human",
          name: ""
        },
        created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
      },
      intents: intents.map(intent => {
        // Clean up the intent object - remove undefined values
        const cleaned: any = {
          kind: intent.kind,
          scope: intent.scope
        };

        if (intent.entity) cleaned.entity = intent.entity;
        if (intent.fields && intent.fields.length > 0) {
          cleaned.fields = intent.fields.map(field => {
            const cleanedField: any = {
              name: field.name,
              type: field.type
            };
            if (field.required !== undefined) cleanedField.required = field.required;
            if (field.unique !== undefined) cleanedField.unique = field.unique;
            if (field.default !== undefined && field.default !== "") cleanedField.default = field.default;
            if (field.max_length !== undefined) cleanedField.max_length = field.max_length;
            if (field.array_type) cleanedField.array_type = field.array_type;
            if (field.enum_values && field.enum_values.length > 0) cleanedField.enum_values = field.enum_values;
            return cleanedField;
          });
        }
        if (intent.relation) cleaned.relation = intent.relation;
        if (intent.method) cleaned.method = intent.method;
        if (intent.path) cleaned.path = intent.path;
        if (intent.description) cleaned.description = intent.description;
        if (intent.capability) cleaned.capability = intent.capability;
        if (intent.framework) cleaned.framework = intent.framework;
        if (intent.provider) cleaned.provider = intent.provider;
        if (intent.config) cleaned.config = intent.config;

        return cleaned;
      })
    };

    return yaml.dump(yamlObj);
  };

  const handleCreateIntent = async () => {
    if (!newIntentName.trim()) {
      setError("Intent name is required");
      return;
    }

    if (!selectedFolder) {
      setError("Please select a folder first");
      return;
    }

    const electronAPI = getElectronAPI();
    if (!electronAPI) {
      setError("Electron API not available");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Set flag to ignore file changes during intent creation
      isCreatingIntentRef.current = true;

      // Stop file watching during intent creation to prevent reload loops
      await electronAPI.stopWatching?.();

      const oimlPath = `${selectedFolder}/.oiml`;
      const projectYamlPath = `${oimlPath}/project.yaml`;
      const intentsPath = `${oimlPath}/intents`;

      // Check if project.yaml exists
      const projectExists = await electronAPI.fileExists(projectYamlPath);
      if (!projectExists) {
        setError("project.yaml not found. Please ensure this is an OIML project.");
        setIsLoading(false);
        return;
      }

      // Read project.yaml to get version
      const projectResult = await electronAPI.readFile(projectYamlPath);
      if (!projectResult.success || !projectResult.content) {
        setError("Failed to read project.yaml");
        setIsLoading(false);
        return;
      }

      const projectConfig = yaml.load(projectResult.content) as ProjectConfig;
      if (!projectConfig.version) {
        setError("project.yaml is missing version field");
        setIsLoading(false);
        return;
      }

      // Sanitize the name
      const sanitizedName = sanitizeFileName(newIntentName);
      const intentFolderPath = `${intentsPath}/${sanitizedName}`;
      const intentFilePath = `${intentFolderPath}/intent.yaml`;

      // Check if folder already exists
      const folderExists = await electronAPI.fileExists(intentFolderPath);
      if (folderExists) {
        setError(`Intent folder ${sanitizedName} already exists`);
        setIsLoading(false);
        return;
      }

      // Create the intent folder
      const mkdirResult = await electronAPI.mkdir(intentFolderPath);
      if (!mkdirResult.success) {
        setError(`Failed to create intent folder: ${mkdirResult.error}`);
        setIsLoading(false);
        return;
      }

      // Generate intent file content
      const intentContent = generateIntentTemplate(newIntentName, projectConfig.version, builderIntents);

      // Write the intent.yaml file
      const writeResult = await electronAPI.writeFile(intentFilePath, intentContent);
      if (!writeResult.success) {
        setError(`Failed to create intent.yaml: ${writeResult.error}`);
        setIsLoading(false);
        return;
      }

      // Set the ref to the new intent ID so loadOIMLData will select it
      selectedIntentIdRef.current = sanitizedName;

      // Reload OIML data to show the new intent
      await loadOIMLData(selectedFolder);

      // Ensure the intent tab is active and in human view
      setActiveTab("intent");

      // Resume file watching after intent creation
      await electronAPI.watchFolder?.(selectedFolder);

      // Clear flag to allow file changes again
      isCreatingIntentRef.current = false;

      // Close dialog and reset form
      setIsAddIntentDialogOpen(false);
      setNewIntentName("");
      setBuilderIntents([]);
    } catch (err) {
      setError(`Error creating intent: ${err instanceof Error ? err.message : "Unknown error"}`);
      // Resume file watching even if there was an error
      await electronAPI.watchFolder?.(selectedFolder);
      // Clear flag even on error
      isCreatingIntentRef.current = false;
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveIntents = async () => {
    if (!selectedIntent || !selectedFolder) {
      return;
    }

    const electronAPI = getElectronAPI();
    if (!electronAPI) {
      setError("Electron API not available");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const intentFilePath = `${selectedIntent.path}/intent.yaml`;

      // Read the existing intent.yaml file
      const readResult = await electronAPI.readFile(intentFilePath);
      if (!readResult.success || !readResult.content) {
        setError("Failed to read intent.yaml");
        setIsLoading(false);
        return;
      }

      // Parse the existing YAML
      const existingData = yaml.load(readResult.content) as any;
      if (!existingData) {
        setError("Failed to parse intent.yaml");
        setIsLoading(false);
        return;
      }

      // Convert Intent[] to the format expected in intent.yaml
      const cleanedIntents = editIntents.map(intent => {
        const cleaned: any = {
          kind: intent.kind,
          scope: intent.scope
        };

        if (intent.entity) cleaned.entity = intent.entity;
        if (intent.fields && intent.fields.length > 0) {
          cleaned.fields = intent.fields.map(field => {
            const cleanedField: any = {
              name: field.name,
              type: field.type
            };
            if (field.required !== undefined) cleanedField.required = field.required;
            if (field.unique !== undefined) cleanedField.unique = field.unique;
            if (field.default !== undefined && field.default !== "") cleanedField.default = field.default;
            if (field.max_length !== undefined) cleanedField.max_length = field.max_length;
            if (field.array_type) cleanedField.array_type = field.array_type;
            if (field.enum_values && field.enum_values.length > 0) cleanedField.enum_values = field.enum_values;
            return cleanedField;
          });
        }
        if (intent.relation) cleaned.relation = intent.relation;
        if (intent.method) cleaned.method = intent.method;
        if (intent.path) cleaned.path = intent.path;
        if (intent.description) cleaned.description = intent.description;
        if (intent.capability) cleaned.capability = intent.capability;
        if (intent.framework) cleaned.framework = intent.framework;
        if (intent.provider) cleaned.provider = intent.provider;
        if (intent.config) cleaned.config = intent.config;

        return cleaned;
      });

      // Update the intents array while preserving all other fields
      const updatedData = {
        ...existingData,
        intents: cleanedIntents
      };

      // Convert back to YAML
      const updatedYaml = yaml.dump(updatedData, {
        indent: 2,
        lineWidth: -1
      });

      // Write the updated file
      const writeResult = await electronAPI.writeFile(intentFilePath, updatedYaml);
      if (!writeResult.success) {
        setError(`Failed to update intent.yaml: ${writeResult.error}`);
        setIsLoading(false);
        return;
      }

      // Reload OIML data to refresh the intent
      await loadOIMLData(selectedFolder);

      // Close dialog and reset form
      setIsEditIntentsDialogOpen(false);
      setEditIntents([]);
    } catch (err) {
      setError(`Error saving intents: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteIntentFromArray = async (intentIndex: number) => {
    if (!selectedIntent || !selectedFolder) {
      return;
    }

    const electronAPI = getElectronAPI();
    if (!electronAPI) {
      setError("Electron API not available");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const intentFilePath = `${selectedIntent.path}/intent.yaml`;

      // Read the existing intent.yaml file
      const readResult = await electronAPI.readFile(intentFilePath);
      if (!readResult.success || !readResult.content) {
        setError("Failed to read intent.yaml");
        setIsLoading(false);
        return;
      }

      // Parse the existing YAML
      const existingData = yaml.load(readResult.content) as any;
      if (!existingData) {
        setError("Failed to parse intent.yaml");
        setIsLoading(false);
        return;
      }

      // Remove the intent at the specified index
      const updatedIntents = [...(existingData.intents || [])];
      if (intentIndex >= 0 && intentIndex < updatedIntents.length) {
        updatedIntents.splice(intentIndex, 1);
      } else {
        setError("Invalid intent index");
        setIsLoading(false);
        return;
      }

      // Update the intents array while preserving all other fields
      const updatedData = {
        ...existingData,
        intents: updatedIntents
      };

      // Convert back to YAML
      const updatedYaml = yaml.dump(updatedData, {
        indent: 2,
        lineWidth: -1
      });

      // Write the updated file
      const writeResult = await electronAPI.writeFile(intentFilePath, updatedYaml);
      if (!writeResult.success) {
        setError(`Failed to update intent.yaml: ${writeResult.error}`);
        setIsLoading(false);
        return;
      }

      // Reload OIML data to refresh the intent
      await loadOIMLData(selectedFolder);
    } catch (err) {
      setError(`Error deleting intent: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteIntent = async (intentId?: string) => {
    const intentToDelete = intentId ? intents.find(i => i.id === intentId) : selectedIntent;

    if (!intentToDelete || !selectedFolder) {
      return;
    }

    const electronAPI = getElectronAPI();
    if (!electronAPI) {
      setError("Electron API not available");
      return;
    }

    // Confirm deletion
    if (!confirm(`Are you sure you want to delete intent "${intentToDelete.id}"? This action cannot be undone.`)) {
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const intentFolderPath = intentToDelete.path;

      // Delete the intent folder
      const deleteResult = await electronAPI.rmdir(intentFolderPath);
      if (!deleteResult.success) {
        setError(`Failed to delete intent folder: ${deleteResult.error}`);
        setIsLoading(false);
        return;
      }

      // Reload OIML data to refresh the intents list
      await loadOIMLData(selectedFolder);

      // Clear selected intent if it was the one deleted
      if (selectedIntent?.id === intentToDelete.id) {
        updateSelectedIntent(null);
      }
    } catch (err) {
      setError(`Error deleting intent: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsLoading(false);
    }
  };

  const loadOIMLData = async (folderPath: string) => {
    const electronAPI = getElectronAPI();
    if (!electronAPI) {
      return;
    }

    // Capture current selectedIntent ID from ref (always current, not stale)
    const currentSelectedIntentId = selectedIntentIdRef.current;

    setIsLoading(true);
    setError(null);

    try {
      const oimlPath = `${folderPath}/.oiml`;
      const projectYamlPath = `${oimlPath}/project.yaml`;
      const intentsPath = `${oimlPath}/intents`;

      // Check if .oiml directory exists
      const oimlExists = await electronAPI.fileExists(oimlPath);
      if (!oimlExists) {
        setError("No .oiml directory found in the selected folder.");
        // Clear intents and project config when .oiml folder is not found
        setIntents([]);
        setProjectConfig(null);
        updateSelectedIntent(null);
        setIsLoading(false);
        return;
      }

      // Load project.yaml
      const projectExists = await electronAPI.fileExists(projectYamlPath);
      if (projectExists) {
        const result = await electronAPI.readFile(projectYamlPath);
        if (result.success && result.content) {
          try {
            const config = yaml.load(result.content) as ProjectConfig;
            setProjectConfig(config);
          } catch (err) {
            console.error("Error parsing project.yaml:", err);
            setError("Error parsing project.yaml file.");
          }
        }
      }

      // Load intents
      const intentsExists = await electronAPI.fileExists(intentsPath);
      if (intentsExists) {
        const dirResult = await electronAPI.readDirectory(intentsPath);
        if (dirResult.success && dirResult.entries) {
          const intentDirs = dirResult.entries.filter(e => e.isDirectory);
          const intentInfos: IntentInfo[] = [];

          for (const intentDir of intentDirs) {
            const intentId = intentDir.name;
            const intentYamlPath = `${intentDir.path}/intent.yaml`;
            const planYamlPath = `${intentDir.path}/plan.yaml`;
            const summaryYamlPath = `${intentDir.path}/summary.yaml`;

            const hasIntent = await electronAPI.fileExists(intentYamlPath);
            const hasPlan = await electronAPI.fileExists(planYamlPath);
            const hasSummary = await electronAPI.fileExists(summaryYamlPath);

            const intentInfo: IntentInfo = {
              id: intentId,
              path: intentDir.path,
              hasIntent,
              hasPlan,
              hasSummary
            };

            // Load intent.yaml if it exists
            if (hasIntent) {
              const intentResult = await electronAPI.readFile(intentYamlPath);
              if (intentResult.success && intentResult.content) {
                // Store raw YAML content for validation
                intentInfo.intentYamlContent = intentResult.content;
                try {
                  intentInfo.intentData = yaml.load(intentResult.content) as Intent[];
                  // Validate the intent
                  if (intentInfo.intentData && intentResult.content) {
                    const validationResult = await validateIntent(intentResult.content);
                    if (!validationResult.valid && validationResult.errors) {
                      intentInfo.validationErrors = validationResult.errors;
                    }
                  }
                } catch (err) {
                  console.error(`[loadOIMLData] ✗ Error parsing intent.yaml for ${intentId}:`, err);
                  intentInfo.validationErrors = [
                    `Failed to parse YAML: ${err instanceof Error ? err.message : String(err)}`
                  ];
                }
              }
            }

            // Load plan.yaml if it exists
            if (hasPlan) {
              const planResult = await electronAPI.readFile(planYamlPath);
              if (planResult.success && planResult.content) {
                try {
                  intentInfo.planData = yaml.load(planResult.content);
                } catch (err) {
                  console.error(`Error parsing plan.yaml for ${intentId}:`, err);
                }
              }
            }

            // Load summary.yaml if it exists
            if (hasSummary) {
              const summaryResult = await electronAPI.readFile(summaryYamlPath);
              if (summaryResult.success && summaryResult.content) {
                try {
                  intentInfo.summaryData = yaml.load(summaryResult.content);
                } catch (err) {
                  console.error(`Error parsing summary.yaml for ${intentId}:`, err);
                }
              }
            }

            // Only include intents that have an intent.yaml file
            if (hasIntent) {
              intentInfos.push(intentInfo);
            }
          }

          // Sort intents so "_init" appears first
          intentInfos.sort((a, b) => {
            if (a.id === "_init") return -1;
            if (b.id === "_init") return 1;
            return a.id.localeCompare(b.id);
          });

          setIntents(intentInfos);

          // Update selectedIntent if it was selected before reload and still exists
          if (currentSelectedIntentId) {
            const updatedIntent = intentInfos.find(intent => intent.id === currentSelectedIntentId);
            if (updatedIntent) {
              updateSelectedIntent(updatedIntent);
            }
            // If intent was deleted, selection remains null (no auto-select)
          } else {
            updateSelectedIntent(null);
          }
        }
      }
    } catch (err) {
      setError(`Error loading OIML data: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Show loading spinner during initialization
  if (isInitializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
        <div className="flex flex-col items-center gap-4">
          <Spinner className="w-8 h-8" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Helper function to get folder name from path
  const getFolderName = (path: string): string => {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  };

  // Helper function to get parent directory path
  const getParentPath = (path: string): string => {
    const parts = path.split(/[/\\]/).filter(p => p.length > 0);
    parts.pop(); // Remove the folder name itself

    // Replace first two directories with ~
    if (parts.length >= 2) {
      return `~/${parts.slice(2).join("/")}`;
    } else if (parts.length === 1) {
      return `~/${parts[0]}`;
    }
    return "~";
  };

  // Helper function to format full path (replaces first two directories with ~)
  const formatPath = (path: string): string => {
    const parts = path.split(/[/\\]/).filter(p => p.length > 0);

    // Replace first two directories with ~
    if (parts.length >= 2) {
      return `~/${parts.slice(2).join("/")}`;
    } else if (parts.length === 1) {
      return `~/${parts[0]}`;
    }
    return path;
  };

  // Show folder selection UI (Cursor-style)
  if (!selectedFolder) {
    return (
      <div className="flex h-screen flex-col bg-zinc-50 font-sans dark:bg-black overflow-hidden">
        {/* Header */}
        <div
          className="h-12 bg-background dark:bg-black shrink-0"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />

        {/* Main Content - Centered */}
        <div className="flex-1 flex items-center justify-center select-none">
          <div className="flex w-full max-w-2xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
            <div className="w-full">
              <Card className="w-full">
                <CardHeader>
                  {/* Logo and Name */}
                  <div className="flex items-center">
                    <div className="flex items-center gap-1">
                      <svg className="w-6 h-6" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="256" cy="256" r="50" fill="white" />
                        <circle cx="256" cy="140" r="32" fill="white" />
                        <line
                          x1="256"
                          y1="206"
                          x2="256"
                          y2="172"
                          stroke="white"
                          strokeWidth="16"
                          strokeLinecap="round"
                        />
                        <circle cx="356" cy="190" r="32" fill="white" />
                        <line
                          x1="296"
                          y1="226"
                          x2="324"
                          y2="206"
                          stroke="white"
                          strokeWidth="16"
                          strokeLinecap="round"
                        />
                        <circle cx="356" cy="322" r="32" fill="white" />
                        <line
                          x1="296"
                          y1="286"
                          x2="324"
                          y2="306"
                          stroke="white"
                          strokeWidth="16"
                          strokeLinecap="round"
                        />
                        <circle cx="256" cy="372" r="32" fill="white" />
                        <line
                          x1="256"
                          y1="306"
                          x2="256"
                          y2="340"
                          stroke="white"
                          strokeWidth="16"
                          strokeLinecap="round"
                        />
                        <circle cx="156" cy="322" r="32" fill="white" />
                        <line
                          x1="216"
                          y1="286"
                          x2="188"
                          y2="306"
                          stroke="white"
                          strokeWidth="16"
                          strokeLinecap="round"
                        />
                        <circle cx="156" cy="190" r="32" fill="white" />
                        <line
                          x1="216"
                          y1="226"
                          x2="188"
                          y2="206"
                          stroke="white"
                          strokeWidth="16"
                          strokeLinecap="round"
                        />
                      </svg>
                      <h1 className="text-lg font-semibold">OIML Studio</h1>
                    </div>
                  </div>
                  <a
                    href="https://oiml.dev/docs"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Getting Started
                  </a>
                </CardHeader>
                <CardContent>
                  <Button onClick={handleSelectFolder} className="w-full" disabled={!isElectron}>
                    <FolderOpenIcon className="w-4 h-4 mr-2" />
                    Open Project
                  </Button>
                  {!isElectron && (
                    <p className="text-sm text-muted-foreground mt-4">
                      Electron API not available. Please run this app in Electron.
                    </p>
                  )}
                  {error && <p className="text-sm text-red-500 mt-4">{error}</p>}
                  {/* Recent Projects */}
                  {recentProjects.length > 0 && (
                    <div className="mt-8">
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xs font-semibold text-foreground">Recent projects</h2>
                        <button
                          onClick={async () => {
                            const electronAPI = getElectronAPI();
                            if (electronAPI) {
                              await electronAPI.clearRecentProjects?.();
                              setRecentProjects([]);
                            }
                          }}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                        >
                          Clear
                        </button>
                      </div>
                      <div className="space-y-1">
                        {recentProjects.slice(0, 5).map(projectPath => (
                          <button
                            key={projectPath}
                            onClick={() => handleOpenProject(projectPath)}
                            className="w-full group flex items-center justify-between p-3 rounded-md hover:bg-accent transition-colors text-left"
                            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                          >
                            <div className="text-xs font-semibold text-muted-foreground truncate flex-1">
                              {getFolderName(projectPath)}
                            </div>
                            <div className="text-xs text-muted-foreground truncate ml-4 flex-shrink-0">
                              {getParentPath(projectPath)}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Master-detail view with sidebar
  return (
    <div className="flex h-screen bg-zinc-50 font-sans dark:bg-black overflow-hidden flex-col">
      {/* Header */}
      <div
        className="h-12 border-b border-border bg-background flex items-center px-4 flex-shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="flex-1 flex items-center justify-center">
          {projectConfig?.name && <h1 className="text-xs font-semibold">{projectConfig.name}</h1>}
        </div>
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          {selectedFolder && (
            <>
              {/* {!error && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAddIntentDialogOpen(true)}
                  className="h-8 w-8 p-0"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              )} */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                    <Settings className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setIsProjectSettingsDialogOpen(true)}>
                    <Settings className="size-4 text-muted-foreground" />
                    <span>Project Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleSelectFolder} disabled={!isElectron}>
                    <FolderOpenIcon className="size-4 text-muted-foreground" />
                    <span>Open Project</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Theme</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={theme || "system"} onValueChange={setTheme}>
                    <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        {!error && intents.length > 0 && (
          <div className="w-64 border-r border-border bg-background flex flex-col select-none">
            {/* Intents List */}
            <ScrollArea className="flex-1">
              <div className="p-2">
                <div className="flex items-center justify-between py-2 mb-1">
                  <h2 className="text-sm font-semibold pl-1">Intents</h2>
                  {!error && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsAddIntentDialogOpen(true)}
                      className="h-8 w-8 p-0"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {intents.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileTextIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No intents found</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {intents.map(intent => {
                      const status = intent.summaryData?.status || (intent.planData ? "planned" : "draft");
                      // const intentKind =
                      //   intent.intentData?.intents?.[0]?.kind || "unknown";
                      const isSelected = selectedIntent?.id === intent.id;

                      return (
                        <DropdownMenu
                          key={intent.id}
                          open={contextMenuIntentId === intent.id}
                          onOpenChange={open => {
                            if (!open) {
                              setContextMenuIntentId(null);
                              setContextMenuPosition(null);
                            }
                          }}
                        >
                          <DropdownMenuTrigger asChild>
                            <button
                              onClick={() => {
                                setIsProjectSettingsDialogOpen(false);
                                updateSelectedIntent(intent);
                                // Set default tab based on available data
                                if (intent.intentData) {
                                  setActiveTab("intent");
                                } else if (intent.planData) {
                                  setActiveTab("plan");
                                } else if (intent.summaryData) {
                                  setActiveTab("summary");
                                }
                              }}
                              onContextMenu={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                const rect = e.currentTarget.getBoundingClientRect();
                                setContextMenuIntentId(intent.id);
                                setContextMenuPosition({ x: rect.right, y: rect.top });
                              }}
                              className={`w-full text-left py-2 px-3 rounded-md transition-colors hover:cursor-pointer ${
                                isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                              }`}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-xs truncate">{intent.id}</span>
                                  </div>
                                </div>
                                {status === "success" ? (
                                  <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0 ml-2" />
                                ) : (
                                  <CheckCircle className="w-3 h-3 text-gray-500 dark:text-gray-400 flex-shrink-0 ml-2" />
                                )}
                              </div>
                            </button>
                          </DropdownMenuTrigger>
                          {contextMenuIntentId === intent.id && (
                            <DropdownMenuContent align="start" side="right" className="z-50">
                              <DropdownMenuItem
                                className="text-red-600 dark:text-red-400"
                                onClick={e => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  handleDeleteIntent(intent.id);
                                  setContextMenuIntentId(null);
                                  setContextMenuPosition(null);
                                }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          )}
                        </DropdownMenu>
                      );
                    })}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Detail View */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {isLoading ? null : error ? (
            <div className="flex items-center justify-center h-full p-6">
              <Card className="w-full max-w-lg">
                <CardHeader className="text-center">
                  <div className="mx-auto mb-4 w-16 h-16 bg-muted rounded-full flex items-center justify-center">
                    <FolderOpenIcon className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <CardTitle>OIML Not Enabled</CardTitle>
                  <CardDescription>Please select an option below to get started</CardDescription>
                  {selectedFolder && (
                    <div className="mt-4 pt-4 border-t border-border text-left">
                      <p className="text-xs text-muted-foreground">Current folder:</p>
                      <p className="text-xs font-semibold text-foreground mt-1">{formatPath(selectedFolder)}</p>
                    </div>
                  )}
                </CardHeader>
                <CardContent className="text-center">
                  {error === "No .oiml directory found in the selected folder." && selectedFolder ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <button
                        onClick={handleInitializeOIML}
                        disabled={isLoading}
                        className="group relative p-6 rounded-lg border border-border bg-card hover:bg-accent transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed hover:cursor-pointer"
                        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                      >
                        <div className="w-12 h-12 flex items-center justify-center">
                          <svg className="w-8 h-8" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="256" cy="256" r="50" fill="white" />
                            <circle cx="256" cy="140" r="32" fill="white" />
                            <line
                              x1="256"
                              y1="206"
                              x2="256"
                              y2="172"
                              stroke="white"
                              strokeWidth="16"
                              strokeLinecap="round"
                            />
                            <circle cx="356" cy="190" r="32" fill="white" />
                            <line
                              x1="296"
                              y1="226"
                              x2="324"
                              y2="206"
                              stroke="white"
                              strokeWidth="16"
                              strokeLinecap="round"
                            />
                            <circle cx="356" cy="322" r="32" fill="white" />
                            <line
                              x1="296"
                              y1="286"
                              x2="324"
                              y2="306"
                              stroke="white"
                              strokeWidth="16"
                              strokeLinecap="round"
                            />
                            <circle cx="256" cy="372" r="32" fill="white" />
                            <line
                              x1="256"
                              y1="306"
                              x2="256"
                              y2="340"
                              stroke="white"
                              strokeWidth="16"
                              strokeLinecap="round"
                            />
                            <circle cx="156" cy="322" r="32" fill="white" />
                            <line
                              x1="216"
                              y1="286"
                              x2="188"
                              y2="306"
                              stroke="white"
                              strokeWidth="16"
                              strokeLinecap="round"
                            />
                            <circle cx="156" cy="190" r="32" fill="white" />
                            <line
                              x1="216"
                              y1="226"
                              x2="188"
                              y2="206"
                              stroke="white"
                              strokeWidth="16"
                              strokeLinecap="round"
                            />
                          </svg>
                        </div>
                        <h3 className="text-xs font-semibold mb-1">
                          {isLoading ? "Initializing..." : "Initialize OIML"}
                        </h3>
                      </button>
                      <button
                        onClick={handleSelectFolder}
                        className="group relative p-6 rounded-lg border border-border bg-card hover:bg-accent transition-colors text-left hover:cursor-pointer"
                        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                      >
                        <div className="w-12 h-12 flex items-center justify-center">
                          <FolderOpenIcon className="w-6 h-6 text-foreground" />
                        </div>
                        <h3 className="text-xs font-semibold mb-1">Open Project</h3>
                      </button>
                      <a
                        href="https://oiml.dev/docs"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group relative p-6 rounded-lg border border-border bg-card hover:bg-accent transition-colors text-left block"
                        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                      >
                        <div className="w-12 h-12 flex items-center justify-center">
                          <FileTextIcon className="w-6 h-6 text-foreground" />
                        </div>
                        <h3 className="text-xs font-semibold mb-1">View Docs</h3>
                      </a>
                    </div>
                  ) : (
                    <Button onClick={handleSelectFolder} className="w-full">
                      <FolderOpenIcon className="w-4 h-4 mr-2" />
                      Open Project
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : isLoading ? null : selectedIntent ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Header */}
              <div className="p-6 pb-0 flex-shrink-0">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <h1 className="text-xl font-semibold">{selectedIntent.id}</h1>
                  </div>
                  {/* <div className="flex-1">
                    <h1 className="text-2xl font-semibold">{selectedIntent.id}</h1>
                    {selectedIntent.summaryData?.model && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                        {getModelIcon(selectedIntent.summaryData.model)}
                        <span className="font-semibold text-xs">{selectedIntent.summaryData.model}</span>
                      </div>
                    )}
                  </div> */}
                  <div className="flex items-center gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setIsIntentYamlDialogOpen(true)}>
                          <Code className="mr-2 h-4 w-4" />
                          View Code
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-red-600 dark:text-red-400"
                          onClick={() => handleDeleteIntent()}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                {/* <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  {selectedIntent.intentData?.intents?.[0]?.kind && (
                    <span>
                      Kind: {selectedIntent.intentData.intents[0].kind}
                    </span>
                  )}
                  {selectedIntent.intentData?.intents?.[0]?.scope && (
                    <span>
                      Scope: {selectedIntent.intentData.intents[0].scope}
                    </span>
                  )}
                </div> */}
              </div>

              {/* Tabs */}
              <div className="flex-1 flex flex-col overflow-hidden px-6 pt-4 min-h-0">
                <Tabs
                  value={activeTab}
                  onValueChange={setActiveTab}
                  className="flex-1 flex flex-col overflow-hidden min-h-0"
                >
                  <TabsList className="flex-shrink-0 mb-4">
                    <TabsTrigger value="intent" icon={<Zap className="w-4 h-4" />}>
                      Intent
                    </TabsTrigger>
                    <TabsTrigger value="plan" icon={<ListChecks className="w-4 h-4" />}>
                      Plan
                    </TabsTrigger>
                    <TabsTrigger value="summary" icon={<FileCheck className="w-4 h-4" />}>
                      Summary
                    </TabsTrigger>
                    {/* <TabsTrigger value="linear" icon={<LinearIcon className="w-4 h-4" />}>
                      Linear
                    </TabsTrigger> */}
                  </TabsList>

                  <div className="flex-1 overflow-hidden min-h-0">
                    <ScrollArea className="h-full">
                      <div className="pb-6">
                        {/* Intent Tab */}
                        <TabsContent value="intent" className="mt-0">
                          <div className="space-y-4">
                            {/* Validation Banner */}
                            {selectedIntent.validationErrors && selectedIntent.validationErrors.length > 0 && (
                              <>
                                {selectedIntent.validationErrors.some(error =>
                                  error.includes("intents: Array must contain at least 1 element(s)")
                                ) ? (
                                  <Card>
                                    <CardContent className="pt-6">
                                      <div className="text-center text-muted-foreground space-y-4">
                                        <p className="text-sm">You haven&apos;t add any intents yet.</p>
                                        <Button
                                          size="sm"
                                          onClick={() => {
                                            // Initialize editIntents with existing intents from the intent.yaml file
                                            const intentData = selectedIntent.intentData as any;
                                            const existingIntents = intentData?.intents || [];
                                            setEditIntents(existingIntents);
                                            setIsEditIntentsDialogOpen(true);
                                          }}
                                          className="gap-2"
                                        >
                                          <Plus className="h-4 w-4" />
                                          Add Intent
                                        </Button>
                                      </div>
                                    </CardContent>
                                  </Card>
                                ) : (
                                  <Card className="border-red-500 dark:border-red-500/50 bg-red-50 dark:bg-red-950/20">
                                    <CardHeader className="pb-3">
                                      <div className="flex items-start gap-2">
                                        <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                                        <div className="flex-1">
                                          <CardTitle className="text-sm text-red-900 dark:text-red-100">
                                            Schema Validation Failed
                                          </CardTitle>
                                          <CardDescription className="text-xs text-red-700 dark:text-red-300 mt-1">
                                            The intent.yaml file does not conform to the OIML schema version{" "}
                                            {selectedIntent.intentData?.version || "unknown"}.
                                          </CardDescription>
                                        </div>
                                      </div>
                                    </CardHeader>
                                    <CardContent className="pt-0">
                                      <ul className="list-disc list-inside space-y-1 text-sm text-red-800 dark:text-red-200">
                                        {selectedIntent.validationErrors.map((error, index) => (
                                          <li key={index}>{error}</li>
                                        ))}
                                      </ul>
                                    </CardContent>
                                  </Card>
                                )}
                              </>
                            )}

                            {selectedIntent.intentData ? (
                              <IntentHumanView
                                intentData={selectedIntent.intentData}
                                onDeleteIntent={handleDeleteIntentFromArray}
                              />
                            ) : (
                              <Card>
                                <CardContent className="pt-6">
                                  <div className="text-center text-muted-foreground">
                                    <p className="text-sm">No intent data available</p>
                                    <p className="text-xs mt-2">The intent.yaml file may be empty or invalid.</p>
                                  </div>
                                </CardContent>
                              </Card>
                            )}
                          </div>
                        </TabsContent>

                        {/* Plan Tab */}
                        <TabsContent value="plan" className="mt-0">
                          <Card>
                            <CardHeader>
                              <CardTitle>Plan</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                              {selectedIntent.planData ? (
                                <>
                                  {selectedIntent.planData.risk_assessment && (
                                    <div>
                                      <span className="text-sm font-medium">Risk Level: </span>
                                      <span className="text-sm">{selectedIntent.planData.risk_assessment.level}</span>
                                    </div>
                                  )}
                                  {selectedIntent.planData.steps && selectedIntent.planData.steps.length > 0 && (
                                    <div>
                                      <span className="text-sm font-medium mb-2 block">Planned Steps:</span>
                                      <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                                        {selectedIntent.planData.steps.map((step: any, index: number) => (
                                          <li key={index}>{step.description || step.target}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  <details className="mt-4">
                                    <summary className="cursor-pointer text-sm font-medium">View Full Plan</summary>
                                    <div className="rounded-lg overflow-hidden mt-2">
                                      <SyntaxHighlighter
                                        language="yaml"
                                        style={vscDarkPlus}
                                        customStyle={{
                                          margin: 0,
                                          padding: "1rem",
                                          fontSize: "0.75rem",
                                          lineHeight: "1.5",
                                          backgroundColor: "#111111",
                                          borderRadius: "0.5rem"
                                        }}
                                      >
                                        {yaml.dump(selectedIntent.planData, {
                                          indent: 2,
                                          lineWidth: -1
                                        })}
                                      </SyntaxHighlighter>
                                    </div>
                                  </details>
                                </>
                              ) : (
                                <p className="text-center text-muted-foreground">No plan data available yet</p>
                              )}
                            </CardContent>
                          </Card>
                        </TabsContent>

                        {/* Summary Tab */}
                        <TabsContent value="summary" className="mt-0">
                          <Card>
                            <CardHeader>
                              <CardTitle>Summary</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                              {selectedIntent.summaryData ? (
                                <>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium">Status: </span>
                                    {selectedIntent.summaryData.status === "success" ? (
                                      <CheckCircle className="w-4 h-4 text-green-500" />
                                    ) : (
                                      <span
                                        className={`text-sm px-2 py-1 rounded ${
                                          selectedIntent.summaryData.status === "partial"
                                            ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                                            : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                                        }`}
                                      >
                                        {selectedIntent.summaryData.status}
                                      </span>
                                    )}
                                  </div>
                                  {selectedIntent.summaryData.applied_at && (
                                    <div>
                                      <span className="text-sm font-medium">Applied: </span>
                                      <span className="text-sm">
                                        {new Date(selectedIntent.summaryData.applied_at).toLocaleString()}
                                      </span>
                                    </div>
                                  )}
                                  {selectedIntent.summaryData.changes &&
                                    selectedIntent.summaryData.changes.length > 0 && (
                                      <div>
                                        <span className="text-sm font-medium mb-2 block">
                                          Changes ({selectedIntent.summaryData.changes.length}
                                          ):
                                        </span>
                                        <ul className="space-y-2">
                                          {selectedIntent.summaryData.changes.map((change: any, index: number) => (
                                            <li key={index} className="text-sm">
                                              <div className="flex items-center gap-2">
                                                <span className="font-mono text-xs bg-muted px-2 py-1 rounded">
                                                  {change.action}
                                                </span>
                                                <span className="text-muted-foreground">{change.file}</span>
                                              </div>
                                              {change.description && (
                                                <p className="text-xs text-muted-foreground mt-1 ml-20">
                                                  {change.description}
                                                </p>
                                              )}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  <details className="mt-4">
                                    <summary className="cursor-pointer text-sm font-medium">View Full Summary</summary>
                                    <div className="rounded-lg overflow-hidden mt-2">
                                      <SyntaxHighlighter
                                        language="yaml"
                                        style={vscDarkPlus}
                                        customStyle={{
                                          margin: 0,
                                          padding: "1rem",
                                          fontSize: "0.75rem",
                                          lineHeight: "1.5",
                                          backgroundColor: "#111111",
                                          borderRadius: "0.5rem"
                                        }}
                                      >
                                        {yaml.dump(selectedIntent.summaryData, {
                                          indent: 2,
                                          lineWidth: -1
                                        })}
                                      </SyntaxHighlighter>
                                    </div>
                                  </details>
                                </>
                              ) : (
                                <p className="text-center text-muted-foreground">No summary data available yet</p>
                              )}
                            </CardContent>
                          </Card>
                        </TabsContent>

                        {/* Linear Tab */}
                        {/* <TabsContent value="linear" className="mt-0">
                          {linearAccessToken ? (
                            <LinearIssueView
                              issueId={selectedIntent.id}
                              projectVersion={projectConfig?.version || "0.1.0"}
                              intentFolderPath={
                                selectedFolder ? `${selectedFolder}/.oiml/intents/${selectedIntent.id}` : undefined
                              }
                              projectConfig={projectConfig}
                              onIntentApplied={() => setActiveTab("intent")}
                              openaiApiKey={openaiApiKey}
                            />
                          ) : (
                            <div className="flex flex-col items-center justify-center h-full min-h-[400px] space-y-4">
                              <LinearIcon className="w-16 h-16 opacity-50" />
                              <div className="text-center space-y-2">
                                <h3 className="text-lg font-semibold">Linear Integration Not Enabled</h3>
                                <p className="text-sm text-muted-foreground max-w-sm">
                                  Enable to view Linear issues and automatically generate intents using AI.
                                </p>
                              </div>
                              <Button
                                onClick={() => {
                                  setShowProjectSettings(true);
                                  setActiveTab("intent");
                                }}
                                className="mt-4"
                              >
                                <Settings className="w-4 h-4 mr-2" />
                                Open Project Settings
                              </Button>
                            </div>
                          )}
                        </TabsContent> */}
                      </div>
                    </ScrollArea>
                  </div>
                </Tabs>
              </div>
            </div>
          ) : isLoading ? null : intents.length === 0 ? (
            <div className="flex items-center justify-center h-full p-6">
              <div className="flex w-full max-w-2xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
                <div className="w-full">
                  <Card className="w-full">
                    <CardHeader>
                      {/* Logo and Name */}
                      <div className="flex items-center">
                        <div className="flex items-center gap-1">
                          <h1 className="text-lg font-semibold">{projectConfig?.name || "Project"}</h1>
                        </div>
                      </div>
                      <CardDescription>
                        You haven&apos;t created any intents yet for this project. Where would you like to start?
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <button
                          onClick={() => setIsAddIntentDialogOpen(true)}
                          disabled={!isElectron}
                          className="group relative p-6 rounded-lg border border-border bg-card hover:bg-accent transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed hover:cursor-pointer"
                          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                        >
                          <div className="w-12 h-12 flex items-center justify-center">
                            <Plus className="w-6 h-6 text-foreground" />
                          </div>
                          <h3 className="text-xs font-semibold mb-1">Add Intent</h3>
                        </button>
                        <button
                          onClick={handleSelectFolder}
                          disabled={!isElectron}
                          className="group relative p-6 rounded-lg border border-border bg-card hover:bg-accent transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed hover:cursor-pointer"
                          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                        >
                          <div className="w-12 h-12 flex items-center justify-center">
                            <FolderOpenIcon className="w-6 h-6 text-foreground" />
                          </div>
                          <h3 className="text-xs font-semibold mb-1">Change Project</h3>
                        </button>
                        <a
                          href="https://oiml.dev/docs"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group relative p-6 rounded-lg border border-border bg-card hover:bg-accent transition-colors text-left block"
                          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                        >
                          <div className="w-12 h-12 flex items-center justify-center">
                            <FileTextIcon className="w-6 h-6 text-foreground" />
                          </div>
                          <h3 className="text-xs font-semibold mb-1">View Docs</h3>
                        </a>
                      </div>
                      {error && <p className="text-sm text-red-500 mt-4">{error}</p>}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full p-6">
              <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                  <svg
                    className="w-12 h-12 mx-auto mb-4 opacity-50"
                    viewBox="0 0 512 512"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <circle cx="256" cy="256" r="50" fill="white" />
                    <circle cx="256" cy="140" r="32" fill="white" />
                    <line x1="256" y1="206" x2="256" y2="172" stroke="white" strokeWidth="16" strokeLinecap="round" />
                    <circle cx="356" cy="190" r="32" fill="white" />
                    <line x1="296" y1="226" x2="324" y2="206" stroke="white" strokeWidth="16" strokeLinecap="round" />
                    <circle cx="356" cy="322" r="32" fill="white" />
                    <line x1="296" y1="286" x2="324" y2="306" stroke="white" strokeWidth="16" strokeLinecap="round" />
                    <circle cx="256" cy="372" r="32" fill="white" />
                    <line x1="256" y1="306" x2="256" y2="340" stroke="white" strokeWidth="16" strokeLinecap="round" />
                    <circle cx="156" cy="322" r="32" fill="white" />
                    <line x1="216" y1="286" x2="188" y2="306" stroke="white" strokeWidth="16" strokeLinecap="round" />
                    <circle cx="156" cy="190" r="32" fill="white" />
                    <line x1="216" y1="226" x2="188" y2="206" stroke="white" strokeWidth="16" strokeLinecap="round" />
                  </svg>
                  <CardTitle>No Intent Selected</CardTitle>
                  <CardDescription>Select an intent from the sidebar or create a new one</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button onClick={() => setIsAddIntentDialogOpen(true)} className="w-full" disabled={!isElectron}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Intent
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Add Intent Dialog */}
      <Dialog
        open={isAddIntentDialogOpen}
        onOpenChange={open => {
          setIsAddIntentDialogOpen(open);
          if (!open) {
            setNewIntentName("");
            setBuilderIntents([]);
            setError(null);
          }
        }}
      >
        <DialogContent
          className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
          onInteractOutside={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Add New Intent</DialogTitle>
            {/* <DialogDescription>Enter a name and build your intent using the builder below.</DialogDescription> */}
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 px-1 py-4">
            <div className="space-y-2 flex flex-col">
              <label htmlFor="intent-name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="intent-name"
                placeholder="e.g., FEAT-123"
                value={newIntentName}
                onChange={e => setNewIntentName(e.target.value)}
                autoFocus
              />
              {newIntentName && (
                <p className="text-xs text-muted-foreground">Will be created as: {sanitizeFileName(newIntentName)}</p>
              )}
            </div>

            <div className="space-y-2 flex flex-col">
              <label className="text-sm font-medium">Kind</label>
              <IntentBuilder intents={builderIntents} onChange={setBuilderIntents} />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsAddIntentDialogOpen(false);
                setNewIntentName("");
                setBuilderIntents([]);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreateIntent} disabled={!newIntentName.trim() || isLoading}>
              {isLoading ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Intents Dialog */}
      <Dialog
        open={isEditIntentsDialogOpen}
        onOpenChange={open => {
          setIsEditIntentsDialogOpen(open);
          if (!open) {
            setEditIntents([]);
            setError(null);
          }
        }}
      >
        <DialogContent
          className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
          onInteractOutside={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Add Intent</DialogTitle>
            {/* <DialogDescription>Add or modify intents for this intent file.</DialogDescription> */}
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4">
            <div className="space-y-2">
              {/* <label className="text-sm font-medium">Intent Builder</label> */}
              <IntentBuilder intents={editIntents} onChange={setEditIntents} />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsEditIntentsDialogOpen(false);
                setEditIntents([]);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveIntents}
              disabled={
                isLoading ||
                !Array.isArray(editIntents) ||
                editIntents.length === 0 ||
                editIntents.some(intent => !intent.kind)
              }
            >
              {isLoading ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Intent YAML Dialog */}
      <Dialog open={isIntentYamlDialogOpen} onOpenChange={setIsIntentYamlDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{selectedIntent?.id}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <div className="rounded-lg overflow-hidden border border-border">
              <SyntaxHighlighter
                language="yaml"
                style={vscDarkPlus}
                customStyle={{
                  margin: 0,
                  padding: "1.5rem",
                  fontSize: "0.875rem",
                  lineHeight: "1.5",
                  backgroundColor: "#111111"
                }}
              >
                {editedYaml}
              </SyntaxHighlighter>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setIsIntentYamlDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Project Settings Dialog */}
      <Dialog open={isProjectSettingsDialogOpen} onOpenChange={setIsProjectSettingsDialogOpen}>
        <DialogContent className="max-w-4xl min-h-[500px] max-h-[90vh] overflow-hidden flex flex-col [&>button]:hidden">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>{projectConfig?.name || "Project Settings"}</DialogTitle>
                {projectConfig?.description && (
                  <DialogDescription className="text-xs text-muted-foreground mt-2">
                    {projectConfig.description}
                  </DialogDescription>
                )}
              </div>
              <div className="flex gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setIsProjectSettingsYamlDialogOpen(true)}>
                      <Code className="mr-2 h-4 w-4" />
                      View Code
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <div className="space-y-6">
              {projectConfig ? (
                <>
                  {/* Framework Tiles */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* API Tile */}
                    {projectConfig.api && (
                      <Card className="p-4">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-10 h-10 flex items-center justify-center bg-muted rounded">
                            {projectConfig.api.framework ? (
                              getFrameworkLogoComponent(projectConfig.api.framework, "api") || (
                                <Code className="w-5 h-5 text-muted-foreground" />
                              )
                            ) : (
                              <Code className="w-5 h-5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-1">
                            <h3 className="text-sm font-semibold">API</h3>
                            {projectConfig.api.framework && (
                              <p className="text-xs text-muted-foreground capitalize">{projectConfig.api.framework}</p>
                            )}
                          </div>
                        </div>
                      </Card>
                    )}

                    {/* Database Tile */}
                    {projectConfig.database && (
                      <Card className="p-4">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-10 h-10 flex items-center justify-center bg-muted rounded">
                            {projectConfig.database.framework ? (
                              getFrameworkLogoComponent(projectConfig.database.framework, "database") || (
                                <FileTextIcon className="w-5 h-5 text-muted-foreground" />
                              )
                            ) : (
                              <FileTextIcon className="w-5 h-5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-1">
                            <h3 className="text-sm font-semibold">Database</h3>
                            {projectConfig.database.framework && (
                              <p className="text-xs text-muted-foreground capitalize">
                                {projectConfig.database.framework}
                              </p>
                            )}
                          </div>
                        </div>
                      </Card>
                    )}

                    {/* UI Tile */}
                    {projectConfig.ui && (
                      <Card className="p-4">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-10 h-10 flex items-center justify-center bg-muted rounded">
                            {projectConfig.ui.framework ? (
                              getFrameworkLogoComponent(projectConfig.ui.framework, "ui") || (
                                <Code className="w-5 h-5 text-muted-foreground" />
                              )
                            ) : (
                              <Code className="w-5 h-5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-1">
                            <h3 className="text-sm font-semibold">UI</h3>
                            {projectConfig.ui.framework && (
                              <p className="text-xs text-muted-foreground capitalize">{projectConfig.ui.framework}</p>
                            )}
                          </div>
                        </div>
                      </Card>
                    )}
                  </div>

                  {/* API Keys Settings */}
                  {/* {isElectron && (
                    <div className="pt-6 border-t border-border">
                      <div className="space-y-6">
                        <div>
                          <h3 className="text-sm font-semibold mb-2">OpenAI API Key</h3>
                          <div className="flex gap-2">
                            <Input
                              type="password"
                              placeholder="Enter OpenAI API key"
                              value={openaiApiKey}
                              onChange={e => setOpenaiApiKey(e.target.value)}
                              className="flex-1"
                            />
                            <Button onClick={handleSaveOpenAIKey} disabled={isSavingOpenAIKey} size="sm">
                              {isSavingOpenAIKey ? "Saving..." : "Save"}
                            </Button>
                            {openaiApiKey && (
                              <Button
                                onClick={handleRemoveOpenAIKey}
                                disabled={isSavingOpenAIKey}
                                size="sm"
                                variant="outline"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )} */}
                </>
              ) : (
                <p className="text-center text-muted-foreground">No project configuration found</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setIsProjectSettingsDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Project Settings YAML Dialog */}
      <Dialog open={isProjectSettingsYamlDialogOpen} onOpenChange={setIsProjectSettingsYamlDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{projectConfig?.name || "Project Settings"}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <div className="rounded-lg overflow-hidden border border-border">
              <SyntaxHighlighter
                language="yaml"
                style={vscDarkPlus}
                customStyle={{
                  margin: 0,
                  padding: "1.5rem",
                  fontSize: "0.875rem",
                  lineHeight: "1.5",
                  backgroundColor: "#111111"
                }}
              >
                {projectYaml}
              </SyntaxHighlighter>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setIsProjectSettingsYamlDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
