import { create } from 'zustand';
import type { Profile, WildFlyDatasource, WarPreflightResponse } from '@/types/api-contracts';
import type { AsyncState } from '@/types/frontend';

type Updater<T> = T | ((current: T) => T);
type RequestState = AsyncState;
type WarApplication = { application: string; warFileName: string; environments: string[] };
interface WarDeployStore {
  version: string;
  profileId: string;
  application: string;
  source: string[];
  datasource: WildFlyDatasource | null;
  originalDatasource: WildFlyDatasource | null;
  additionalConfigRequired: boolean;
  duplicateSelections: Record<string, string>;
  applications: WarApplication[];
  applicationState: RequestState;
  applicationError: string;
  profiles: Profile[];
  profileState: RequestState;
  profileError: string;
  datasourceState: RequestState;
  datasourceError: string;
  preflight: WarPreflightResponse | null;
  preflightState: RequestState;
  preflightChecked: boolean;
  error: string;
  cancellationWarning: string;
  submitting: boolean;
  setVersion(value: Updater<string>): void;
  setProfileId(value: Updater<string>): void;
  setApplication(value: Updater<string>): void;
  setSource(value: Updater<string[]>): void;
  setDatasource(value: Updater<WildFlyDatasource | null>): void;
  setOriginalDatasource(value: Updater<WildFlyDatasource | null>): void;
  setAdditionalConfigRequired(value: Updater<boolean>): void;
  setDuplicateSelections(value: Updater<Record<string, string>>): void;
  setApplications(value: Updater<WarApplication[]>): void;
  setApplicationState(value: Updater<RequestState>): void;
  setApplicationError(value: Updater<string>): void;
  setProfiles(value: Updater<Profile[]>): void;
  setProfileState(value: Updater<RequestState>): void;
  setProfileError(value: Updater<string>): void;
  setDatasourceState(value: Updater<RequestState>): void;
  setDatasourceError(value: Updater<string>): void;
  setPreflight(value: Updater<WarPreflightResponse | null>): void;
  setPreflightState(value: Updater<RequestState>): void;
  setPreflightChecked(value: Updater<boolean>): void;
  setError(value: Updater<string>): void;
  setCancellationWarning(value: Updater<string>): void;
  setSubmitting(value: Updater<boolean>): void;
  resetWarDeployment(): void;
}

const resolve = <T>(value: Updater<T>, current: T): T =>
  typeof value === 'function' ? (value as (current: T) => T)(current) : value;

const initialFormState: Pick<
  WarDeployStore,
  | 'version'
  | 'profileId'
  | 'application'
  | 'source'
  | 'datasource'
  | 'originalDatasource'
  | 'additionalConfigRequired'
  | 'duplicateSelections'
> = {
  version: '',
  profileId: '',
  application: '',
  source: [],
  datasource: null,
  originalDatasource: null,
  additionalConfigRequired: false,
  duplicateSelections: {},
};
const initialDataState: Pick<
  WarDeployStore,
  | 'applications'
  | 'applicationState'
  | 'applicationError'
  | 'profiles'
  | 'profileState'
  | 'profileError'
  | 'datasourceState'
  | 'datasourceError'
> = {
  applications: [],
  applicationState: 'idle',
  applicationError: '',
  profiles: [],
  profileState: 'idle',
  profileError: '',
  datasourceState: 'idle',
  datasourceError: '',
};
const initialWorkflowState: Pick<
  WarDeployStore,
  'preflight' | 'preflightState' | 'preflightChecked' | 'error' | 'cancellationWarning' | 'submitting'
> = {
  preflight: null,
  preflightState: 'idle',
  preflightChecked: false,
  error: '',
  cancellationWarning: '',
  submitting: false,
};

type StoreSetter = (partial: Partial<WarDeployStore> | ((state: WarDeployStore) => Partial<WarDeployStore>)) => void;
type WarFormSlice = Pick<
  WarDeployStore,
  | 'version'
  | 'profileId'
  | 'application'
  | 'source'
  | 'datasource'
  | 'originalDatasource'
  | 'additionalConfigRequired'
  | 'duplicateSelections'
  | 'setVersion'
  | 'setProfileId'
  | 'setApplication'
  | 'setSource'
  | 'setDatasource'
  | 'setOriginalDatasource'
  | 'setAdditionalConfigRequired'
  | 'setDuplicateSelections'
>;
type WarDataSlice = Pick<
  WarDeployStore,
  | 'applications'
  | 'applicationState'
  | 'applicationError'
  | 'profiles'
  | 'profileState'
  | 'profileError'
  | 'datasourceState'
  | 'datasourceError'
  | 'setApplications'
  | 'setApplicationState'
  | 'setApplicationError'
  | 'setProfiles'
  | 'setProfileState'
  | 'setProfileError'
  | 'setDatasourceState'
  | 'setDatasourceError'
>;
type WarWorkflowSlice = Pick<
  WarDeployStore,
  | 'preflight'
  | 'preflightState'
  | 'preflightChecked'
  | 'error'
  | 'cancellationWarning'
  | 'submitting'
  | 'setPreflight'
  | 'setPreflightState'
  | 'setPreflightChecked'
  | 'setError'
  | 'setCancellationWarning'
  | 'setSubmitting'
>;

const createWarFormSlice = (set: StoreSetter): WarFormSlice => ({
  ...initialFormState,
  setVersion: (value: Updater<string>) => set((state) => ({ version: resolve(value, state.version) })),
  setProfileId: (value: Updater<string>) => set((state) => ({ profileId: resolve(value, state.profileId) })),
  setApplication: (value: Updater<string>) => set((state) => ({ application: resolve(value, state.application) })),
  setSource: (value: Updater<string[]>) => set((state) => ({ source: resolve(value, state.source) })),
  setDatasource: (value: Updater<WildFlyDatasource | null>) => set((state) => ({ datasource: resolve(value, state.datasource) })),
  setOriginalDatasource: (value: Updater<WildFlyDatasource | null>) =>
    set((state) => ({ originalDatasource: resolve(value, state.originalDatasource) })),
  setAdditionalConfigRequired: (value: Updater<boolean>) =>
    set((state) => ({ additionalConfigRequired: resolve(value, state.additionalConfigRequired) })),
  setDuplicateSelections: (value: Updater<Record<string, string>>) =>
    set((state) => ({ duplicateSelections: resolve(value, state.duplicateSelections) })),
});

const createWarDataSlice = (set: StoreSetter): WarDataSlice => ({
  ...initialDataState,
  setApplications: (value: Updater<WarApplication[]>) => set((state) => ({ applications: resolve(value, state.applications) })),
  setApplicationState: (value: Updater<RequestState>) =>
    set((state) => ({ applicationState: resolve(value, state.applicationState) })),
  setApplicationError: (value: Updater<string>) => set((state) => ({ applicationError: resolve(value, state.applicationError) })),
  setProfiles: (value: Updater<Profile[]>) => set((state) => ({ profiles: resolve(value, state.profiles) })),
  setProfileState: (value: Updater<RequestState>) => set((state) => ({ profileState: resolve(value, state.profileState) })),
  setProfileError: (value: Updater<string>) => set((state) => ({ profileError: resolve(value, state.profileError) })),
  setDatasourceState: (value: Updater<RequestState>) =>
    set((state) => ({ datasourceState: resolve(value, state.datasourceState) })),
  setDatasourceError: (value: Updater<string>) => set((state) => ({ datasourceError: resolve(value, state.datasourceError) })),
});

const createWarWorkflowSlice = (set: StoreSetter): WarWorkflowSlice => ({
  ...initialWorkflowState,
  setPreflight: (value: Updater<WarPreflightResponse | null>) => set((state) => ({ preflight: resolve(value, state.preflight) })),
  setPreflightState: (value: Updater<RequestState>) => set((state) => ({ preflightState: resolve(value, state.preflightState) })),
  setPreflightChecked: (value: Updater<boolean>) =>
    set((state) => ({ preflightChecked: resolve(value, state.preflightChecked) })),
  setError: (value: Updater<string>) => set((state) => ({ error: resolve(value, state.error) })),
  setCancellationWarning: (value: Updater<string>) =>
    set((state) => ({ cancellationWarning: resolve(value, state.cancellationWarning) })),
  setSubmitting: (value: Updater<boolean>) => set((state) => ({ submitting: resolve(value, state.submitting) })),
});

export const useWarDeployStore = create<WarDeployStore>((set) => ({
  ...createWarFormSlice(set),
  ...createWarDataSlice(set),
  ...createWarWorkflowSlice(set),
  resetWarDeployment: () => set({ ...initialFormState, ...initialDataState, ...initialWorkflowState }),
}));
