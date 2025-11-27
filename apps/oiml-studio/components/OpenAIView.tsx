"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AlertCircle, Send } from "lucide-react";
import type { ElectronAPI } from "@/types/electron";
import { Textarea } from "@/components/ui/textarea";

const getElectronAPI = (): ElectronAPI | undefined => {
  if (typeof window === "undefined") return undefined;
  return window.electronAPI;
};

interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export function OpenAIView() {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!prompt.trim()) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setResponse(null);

    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI || !electronAPI.callOpenAI) {
        throw new Error("Electron API not available. This feature requires the Electron app.");
      }

      const result = await electronAPI.callOpenAI(
        [
          {
            role: "user",
            content: prompt
          }
        ],
        "gpt-4"
      );

      if (!result.success) {
        throw new Error(result.error || "Failed to call OpenAI");
      }

      const openAIResponse = result.data as OpenAIResponse | undefined;
      const content = openAIResponse?.choices?.[0]?.message?.content;
      if (content) {
        setResponse(content);
      } else {
        throw new Error("No response content received");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to call OpenAI");
      console.error("Error calling OpenAI:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>OpenAI Chat</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Prompt</label>
            <Textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Enter your prompt here..."
              rows={4}
              className="resize-none"
            />
          </div>

          <Button onClick={handleSubmit} disabled={isLoading || !prompt.trim()} className="w-full">
            {isLoading ? (
              <>
                <Spinner className="mr-2" />
                Processing...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Send
              </>
            )}
          </Button>

          {error && (
            <div className="flex items-center gap-2 text-destructive p-3 bg-destructive/10 rounded-md">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {response && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Response</label>
              <div className="p-4 bg-muted rounded-md">
                <pre className="text-sm whitespace-pre-wrap font-sans">{response}</pre>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
