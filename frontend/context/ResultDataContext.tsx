"use client"

import React, { createContext, useContext, useReducer, ReactNode } from "react";
import { GitHubSourceData,SourceData,SourceType,State } from "@/utils/models";

type Action =
  | { type: "SET_OUTPUT"; payload: string | null }
  | { type: "SET_OUTPUT_MESSAGE"; payload: string | null }
  | { type: "SET_SOURCE_TYPE"; payload: SourceType }
  | { type: "SET_SOURCE_DATA"; payload: SourceData }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "RESET" };

const initialState: State = {
  output: null,
  outputMessage: null,
  sourceType: null,
  sourceData: null,
  loading: false,
  error: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_OUTPUT":
      return { ...state, output: action.payload };
    case "SET_SOURCE_TYPE":
      return { ...state, sourceType: action.payload };
    case "SET_SOURCE_DATA":
      return { ...state, sourceData: action.payload };
    case "SET_LOADING":
      return { ...state, loading: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload };
    case "SET_OUTPUT_MESSAGE":
      return { ...state, outputMessage: action.payload };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

interface ResultDataContextType extends State {
  setOutput: (output: string | null) => void;
  setOutputMessage: (message: string | null) => void;
  setSourceType: (type: SourceType) => void;
  setSourceData: (data: SourceData) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const ResultDataContext = createContext<ResultDataContextType | undefined>(undefined);

export function useResultData() {
  const context = useContext(ResultDataContext);
  if (!context) {
    throw new Error("useResultData must be used within a ResultDataProvider");
  }
  return context;
}

export function ResultDataProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const setOutput = (output: string | null) => dispatch({ type: "SET_OUTPUT", payload: output });
  const setOutputMessage = (message: string | null) => dispatch({ type: "SET_OUTPUT_MESSAGE", payload: message });
  const setSourceType = (type: SourceType) => dispatch({ type: "SET_SOURCE_TYPE", payload: type });
  const setSourceData = (data: SourceData) => dispatch({ type: "SET_SOURCE_DATA", payload: data });
  const setLoading = (loading: boolean) => dispatch({ type: "SET_LOADING", payload: loading });
  const setError = (error: string | null) => dispatch({ type: "SET_ERROR", payload: error });
  const reset = () => dispatch({ type: "RESET" });

  return (
    <ResultDataContext.Provider
      value={{
        ...state,
        setOutput,
        setOutputMessage,
        setSourceType,
        setSourceData,
        setLoading,
        setError,
        reset,
      }}
    >
      {children}
    </ResultDataContext.Provider>
  );
}