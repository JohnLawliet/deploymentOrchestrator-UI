import type { TutorialStep } from '@/components/PageTutorial';

export const warTutorialSteps: TutorialStep[] = [
  {
    target: '[data-tour="war-application"]',
    title: 'Select an application',
    instruction:
      'Choose an application. Based on this selection, files to replace or delete are selected to modify the incoming WAR.',
    why: 'The application identifies the WAR deployment you are preparing.',
  },
  {
    target: '[data-tour="war-version-profile"]',
    title: 'Choose the WildFly version and profile',
    instruction:
      'Select the profile where the WAR should be deployed. WildFly version must also be selected because execution depends on the WildFly instance on which the profile runs.',
    why: 'The selected version limits the available profiles to the correct WildFly server.',
  },
  {
    target: '[data-tour="war-datasource"]',
    title: 'Review the profile datasource',
    instruction:
      "This is data from the profile's standalone.xml. It shows the current configuration: JNDI name, datasource URL, username, and password.",
    why: 'Any edits are applied only as part of this WAR deployment.',
  },
  {
    target: '[data-tour="war-source-config"]',
    title: 'Choose the WAR and additional configuration',
    instruction:
      'This is your Tech Drive folder. Select the WAR file to deploy and check Apply additional WAR configuration. Adding properties, filters, or servlets does not break an existing QC profile after web.xml or .properties files are replaced. To modify an existing property, filter, or servlet, place a correctly formatted additionalConfig.toml in the same directory as the WAR.',
    why: 'The selected Tech Drive path tells the backend which WAR to validate and deploy.',
  },
  {
    target: '[data-tour="war-preflight-toggle"]',
    title: 'Run preflight and reserve the profile',
    instruction:
      'This puts write locks on the source and target profile after validating that the profile is still usable. It also checks for files with the same name in different profile paths. Checking this box starts a timer within which duplicate files must be resolved and the WAR deployed.',
    why: 'The reservation prevents competing deployments while you review file conflicts.',
  },
  {
    target: '[data-tour="war-conflict-resolution"]',
    title: 'Resolve duplicate file paths',
    instruction:
      'Select the file with the correct path for each duplicate. Paths listed in duplicate-file-defaults.properties for common conflicts such as web.xml are already resolved by default.',
    why: 'An explicit selection prevents the deployment from replacing the wrong matching file.',
  },
  {
    target: '[data-tour="war-deploy"]',
    title: 'Deploy before the timer expires',
    instruction: 'Resolve the path conflicts and click Deploy WAR before the timer expires.',
    why: 'When the reservation expires, run preflight again before deploying.',
  },
];

export const jarTutorialSteps: TutorialStep[] = [
  {
    target: '[data-tour="jar-source"]',
    title: 'Select the JAR from Tech Drive',
    instruction: 'Choose one executable JAR from Tech Drive before setting its runtime options.',
    why: 'The browser sends the selected relative path to the backend, which uses that path to find the JAR in Tech Drive.',
  },
  {
    target: '[data-tour="jar-application-name"]',
    title: 'Review the application name',
    instruction: 'The application name is read from the selected JAR filename; it cannot be typed manually.',
    why: 'This identity is used to name and manage the deployed application.',
  },
  {
    target: '[data-tour="jar-launcher-yes"]',
    title: 'Generate launcher settings for a new deployment',
    instruction:
      'Select Yes, include launcher settings. The tour opens the launcher preview, port, and optional Java-path fields for demonstration.',
    why: 'For a new deployment, the port is required. The application name, port, and optional Java executable create the launcher script; health verification is configured separately.',
  },
  {
    target: '[data-tour="jar-launcher-preview"]',
    title: 'Review the launcher script',
    instruction: 'This read-only preview shows the .bat command that will be saved alongside the JAR.',
    why: 'The generated command uses the derived application name, the required port, and either the supplied Java executable or java.',
  },
  {
    target: '[data-tour="jar-health-url"]',
    title: 'Optionally add a health URL',
    instruction: 'Provide an HTTP or HTTPS health endpoint only when the application exposes one.',
    why: 'After deployment, the backend can call this URL to verify the application instead of relying only on PID, Java process, and application-name checks.',
  },
  {
    target: '[data-tour="jar-port"]',
    title: 'Set the application port',
    instruction: 'Enter the port on which the JAR should run.',
    why: 'The port is required for a new launcher and is checked for conflicts before deployment.',
  },
  {
    target: '[data-tour="jar-java-path"]',
    title: 'Optionally set the QC Java path',
    instruction: 'Enter a full path to java.exe only when the default Java executable should not be used.',
    why: 'When this is blank, the launcher uses java from the QC environment.',
  },
  {
    target: '[data-tour="jar-launcher-no"]',
    title: 'Reuse an existing launcher',
    instruction:
      'Select No, reuse existing launcher when this application was deployed before and its saved .bat launcher should be used again.',
    why: 'This is not a backend default. It requires an existing catalogued JAR with an accessible saved launcher and port; a health URL remains optional deployment configuration.',
  },
  {
    target: '[data-tour="jar-frontend-toggle"]',
    title: 'Optionally include a frontend',
    instruction: 'Enable Include frontend when the JAR should be available through a UI served by a frontend profile.',
    why: 'Frontend setup is optional, but it is useful when this backend is accessed through an XAMPP-hosted UI.',
  },
  {
    target: '[data-tour="jar-frontend-modes"]',
    title: 'Choose how to handle the frontend',
    instruction:
      'Use existing frontend association for an already associated JAR. Choose Deploy to frontend to copy selected production build files or folders into a frontend profile.',
    why: 'Reusing is available only when the selected existing JAR has an authoritative association; deployment creates or updates the selected association.',
  },
  {
    target: '[data-tour="jar-frontend-profile"]',
    title: 'Select a frontend profile',
    instruction:
      'Search and select the frontend profile that should receive the build. The tour selects the first available profile only as a temporary demonstration.',
    why: 'The list is populated from the backend’s latest frontend-profile system snapshot, so the selected profile supplies its deployment details.',
  },
  {
    target: '[data-tour="jar-frontend-details"]',
    title: 'Review frontend profile details',
    instruction:
      'Check the URL, reported Running state, Current JAR, and DocumentRoot. The URL opens the site; DocumentRoot identifies where the frontend build belongs.',
    why: 'Running is live backend-reported state, not a guarantee that XAMPP is currently healthy. The generated launcher records the selected profile and DocumentRoot when launcher settings are included.',
  },
  {
    target: '[data-tour="jar-frontend-sources"]',
    title: 'Select the frontend production build',
    instruction:
      'Choose the Tech Drive files and folders to copy to the selected profile. Selecting a folder includes its contained build assets.',
    why: 'The selected paths tell the backend exactly which production files to copy into the profile DocumentRoot.',
  },
  {
    target: '[data-tour="jar-deploy"]',
    title: 'Deploy the JAR',
    instruction: 'Review validation messages and select Deploy JAR once all required fields are complete.',
    why: 'The backend verifies resources and acquires exclusive locks for the JAR profile, port, selected Tech Drive paths, and frontend profile before returning the operation. The operation panel opens as soon as that accepted operation is registered.',
  },
];

export const uatBuildTutorialSteps: TutorialStep[] = [
  {
    target: '[data-tour="uat-inputs"]',
    title: 'Select the build inputs',
    instruction: 'Choose the application, one UAT WAR from Tech Drive, and the matching exploded WAR directory from Jenkins.',
    why: 'The UAT build combines these two inputs to create the deliverable package.',
  },
  {
    target: '[data-tour="uat-inspect"]',
    title: 'Inspect and lock the inputs',
    instruction: 'Select Inspect and lock after choosing the inputs and any optional additional configuration.',
    why: 'The backend validates both paths and locks them while you resolve the build decisions.',
  },
  {
    target: '[data-tour="uat-review"]',
    title: 'Resolve preflight findings',
    instruction:
      'Review warnings and missing files. Select a candidate for every duplicate filename if the backend reports a conflict.',
    why: 'An explicit duplicate choice prevents the build from silently copying the wrong file.',
  },
  {
    target: '[data-tour="uat-convert"]',
    title: 'Create the UAT build',
    instruction: 'Select Convert when blocking findings are resolved, then wait for the operation status to complete.',
    why: 'Conversion packages the build and generates its SHA-256 hash for handoff.',
  },
  {
    target: '[data-tour="uat-opm"]',
    title: 'Copy the OPM handoff message',
    instruction: 'After a successful conversion, open the final step and use Copy OPM message.',
    why: 'The generated message includes the output path and hash needed for the next handoff.',
  },
];

export const uploadTutorialSteps: TutorialStep[] = [
  {
    target: '[data-tour="upload-hotfix-question"]',
    title: 'Is this a hotfix?',
    instruction:
      'Choose Regular file upload when you need to select both Tech Drive source files or folders and a QC destination directory. Choose This is a hotfix for a quicker targeted deployment.',
    why: 'Regular uploads copy the chosen items to the directory you select; hotfixes use a selected frontend or exploded-WAR profile instead.',
  },
  {
    target: '[data-tour="upload-hotfix-type"]',
    title: 'Choose the hotfix type',
    instruction:
      'Choose Frontend XAMPP for a frontend profile, or WAR profile when the hotfix belongs in an exploded WAR deployment.',
    why: 'The hotfix type determines the destination profile list and the validation that runs before deployment.',
  },
  {
    target: '[data-tour="upload-frontend-profile"]',
    title: 'Select the Frontend XAMPP profile',
    instruction:
      'Search and select the frontend profile that should receive the production build. The tutorial temporarily selects the first available profile as an example.',
    why: 'The list comes from the latest SYSTEM_SNAPSHOT. The selected profile supplies its configured document-root path to the backend.',
  },
  {
    target: '[data-tour="upload-production-build"]',
    title: 'Select production build contents',
    instruction:
      'Select the top-level index.html, its sibling files, and every required directory. Do not select the parent build directory, or index.html will be copied one level too deep.',
    why: 'A frontend production build needs index.html and its adjacent assets installed directly into the selected document root.',
  },
  {
    target: '[data-tour="upload-wildfly-profile"]',
    title: 'Select the WildFly profile',
    instruction:
      'Search and select the first matching profile for this hotfix. The tutorial selects the first available profile only as a temporary example.',
    why: 'The scanned profile list identifies the one exploded-WAR profile in which the backend searches for matching destination files.',
  },
  {
    target: '[data-tour="upload-hotfix-sources"]',
    title: 'Select hotfix files and directories',
    instruction:
      'This is your Tech Drive folder. Select only the files and folders you need to replace. XML, Java, and properties files trigger an application restart; other replacements do not.',
    why: 'The selected source paths are the exact items the backend inspects against the chosen WildFly profile.',
  },
  {
    target: '[data-tour="upload-duplicate-resolution"]',
    title: 'Resolve duplicate file matches',
    instruction:
      'If inspection finds more than one destination file with the same name, choose the candidate path that is correct for the hotfix. This tutorial-only example does not inspect or change any files.',
    why: 'An explicit path choice prevents the hotfix from replacing the wrong copy of a file.',
  },
  {
    target: '[data-tour="upload-inspect-hotfix"]',
    title: 'Inspect, then deploy the hotfix',
    instruction:
      'After selecting and verifying the files, choose Inspect hotfix. Inspection only finds and verifies targets; resolve any duplicate candidates, then choose Deploy hotfix to apply changes.',
    why: 'Separating inspection from deployment gives you a chance to confirm every ambiguous destination before anything is replaced.',
  },
];

export const downloadsTutorialSteps: TutorialStep[] = [
  {
    target: '[data-tour="download-browser"]',
    title: 'Browse the QC filesystem',
    instruction: 'Navigate folders, optionally filter entries, and select the files or directories you want to retrieve.',
    why: 'The browser limits selection to the exposed QC root and records whether each item is a file or directory.',
  },
  {
    target: '[data-tour="download-action"]',
    title: 'Download the selection',
    instruction: 'Select Download selection after choosing one or more items.',
    why: 'One selected file downloads directly; directories or multiple items are safely returned as a streamed ZIP archive.',
  },
];
