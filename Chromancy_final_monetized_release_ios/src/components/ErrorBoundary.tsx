import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RefreshCcw, Home } from "lucide-react";
import { reportClientCrash } from "../lib/crashReporting";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<any, any> {
  state: any;
  props: any;

  constructor(props: any) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    reportClientCrash(error, {
      source: "react-error-boundary",
      componentStack: errorInfo.componentStack,
    });
  }

  public render() {
    if (this.state.hasError) {
      let errorMessage = "An unexpected error occurred.";
      
      try {
        // Check if error message is a JSON string (FirestoreErrorInfo)
        const errorData = JSON.parse(this.state.error?.message || "{}");
        if (errorData.error) {
          errorMessage = `Firestore Error: ${errorData.error} during ${errorData.operationType} on ${errorData.path}`;
        }
      } catch {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-8 text-center space-y-8">
          <div className="p-6 rounded-full bg-red-500/10 border border-red-500/20">
            <AlertCircle className="w-16 h-16 text-red-500" />
          </div>
          
          <div className="space-y-2">
            <h2 className="text-3xl font-bold tracking-tight">Something went wrong</h2>
            <p className="text-white/50 text-sm max-w-xs mx-auto">
              {errorMessage}
            </p>
          </div>

          <div className="flex flex-col w-full max-w-xs gap-3">
            <button 
              onClick={() => window.location.reload()}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-white text-black font-bold uppercase tracking-widest hover:bg-white/90 transition-all"
            >
              <RefreshCcw className="w-4 h-4" />
              Reload App
            </button>
            <button 
              onClick={() => window.location.href = '/'}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-white/5 border border-white/10 text-white font-bold uppercase tracking-widest hover:bg-white/10 transition-all"
            >
              <Home className="w-4 h-4" />
              Back to Home
            </button>
          </div>

          <div className="pt-12 opacity-20">
            <p className="text-[10px] font-mono uppercase tracking-widest">CHROMANCY ERROR_LOG_v1.0</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
