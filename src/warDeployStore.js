import { create } from "zustand";

const resolve = (value, current) => typeof value === "function" ? value(current) : value;

const initialFormState = { version: "", profileId: "", application: "", source: [], datasource: null, originalDatasource: null, additionalConfigRequired: false, duplicateSelections: {} };
const initialDataState = { applications: [], applicationState: "idle", applicationError: "", profiles: [], profileState: "idle", profileError: "", datasourceState: "idle", datasourceError: "" };
const initialWorkflowState = { preflight: null, preflightState: "idle", preflightChecked: false, error: "", cancellationWarning: "", submitting: false };

const createWarFormSlice = (set) => ({
  ...initialFormState,
  setVersion: (value) => set((state) => ({ version: resolve(value, state.version) })),
  setProfileId: (value) => set((state) => ({ profileId: resolve(value, state.profileId) })),
  setApplication: (value) => set((state) => ({ application: resolve(value, state.application) })),
  setSource: (value) => set((state) => ({ source: resolve(value, state.source) })),
  setDatasource: (value) => set((state) => ({ datasource: resolve(value, state.datasource) })),
  setOriginalDatasource: (value) => set((state) => ({ originalDatasource: resolve(value, state.originalDatasource) })),
  setAdditionalConfigRequired: (value) => set((state) => ({ additionalConfigRequired: resolve(value, state.additionalConfigRequired) })),
  setDuplicateSelections: (value) => set((state) => ({ duplicateSelections: resolve(value, state.duplicateSelections) })),
});

const createWarDataSlice = (set) => ({
  ...initialDataState,
  setApplications: (value) => set((state) => ({ applications: resolve(value, state.applications) })),
  setApplicationState: (value) => set((state) => ({ applicationState: resolve(value, state.applicationState) })),
  setApplicationError: (value) => set((state) => ({ applicationError: resolve(value, state.applicationError) })),
  setProfiles: (value) => set((state) => ({ profiles: resolve(value, state.profiles) })),
  setProfileState: (value) => set((state) => ({ profileState: resolve(value, state.profileState) })),
  setProfileError: (value) => set((state) => ({ profileError: resolve(value, state.profileError) })),
  setDatasourceState: (value) => set((state) => ({ datasourceState: resolve(value, state.datasourceState) })),
  setDatasourceError: (value) => set((state) => ({ datasourceError: resolve(value, state.datasourceError) })),
});

const createWarWorkflowSlice = (set) => ({
  ...initialWorkflowState,
  setPreflight: (value) => set((state) => ({ preflight: resolve(value, state.preflight) })),
  setPreflightState: (value) => set((state) => ({ preflightState: resolve(value, state.preflightState) })),
  setPreflightChecked: (value) => set((state) => ({ preflightChecked: resolve(value, state.preflightChecked) })),
  setError: (value) => set((state) => ({ error: resolve(value, state.error) })),
  setCancellationWarning: (value) => set((state) => ({ cancellationWarning: resolve(value, state.cancellationWarning) })),
  setSubmitting: (value) => set((state) => ({ submitting: resolve(value, state.submitting) })),
});

export const useWarDeployStore = create((set) => ({
  ...createWarFormSlice(set),
  ...createWarDataSlice(set),
  ...createWarWorkflowSlice(set),
  resetWarDeployment: () => set({ ...initialFormState, ...initialDataState, ...initialWorkflowState }),
}));
