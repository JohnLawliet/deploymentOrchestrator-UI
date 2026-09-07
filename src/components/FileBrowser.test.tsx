import { useState, type ComponentProps } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listFiles = vi.hoisted(() => vi.fn());
const deleteFiles = vi.hoisted(() => vi.fn());
const extractFile = vi.hoisted(() => vi.fn());
const renameFile = vi.hoisted(() => vi.fn());
vi.mock('@/lib/contractApi', () => ({
  EXTRACTION_UNCONFIRMED_MESSAGE: 'The extraction result could not be confirmed. Refresh the directory before trying again.',
  deleteFiles,
  extractFile,
  listFiles,
  renameFile,
}));

import FileBrowser from './FileBrowser';

describe('FileBrowser selectableType', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    listFiles.mockReset();
    deleteFiles.mockReset();
    extractFile.mockReset();
    renameFile.mockReset();
  });

  it('shows Extract here only for supported archive files, including mixed case and .tar.gz', async () => {
    listFiles.mockResolvedValue([
      ...['release.zip', 'app.WAR', 'catalog.Jar', 'bundle.7Z', 'server.TAR.GZ'].map((name) => ({ name, type: 'file' })),
      { name: 'notes.zip.txt', type: 'file' },
      { name: 'folder.zip', type: 'directory' },
    ]);
    render(<FileBrowser rootKey="techDrive" selected={[]} onSelectionChange={vi.fn()} />);

    for (const name of ['release.zip', 'app.WAR', 'catalog.Jar', 'bundle.7Z', 'server.TAR.GZ']) {
      expect(await screen.findByRole('button', { name: `Extract here ${name}` })).toBeEnabled();
    }
    expect(screen.queryByRole('button', { name: 'Extract here notes.zip.txt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Extract here folder.zip' })).not.toBeInTheDocument();
  });

  it('extracts a clicked archive using its current root-relative path and prevents duplicate submissions', async () => {
    listFiles
      .mockResolvedValueOnce([{ name: 'releases', type: 'directory' }])
      .mockResolvedValueOnce([{ name: 'app.tar.gz', type: 'file' }]);
    let resolveExtraction: (value: { rootKey: string; sourcePath: string; destinationPath: string }) => void = () => undefined;
    extractFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveExtraction = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<FileBrowser rootKey="qc" selected={[]} onSelectionChange={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'releases' }));
    const extract = await screen.findByRole('button', { name: 'Extract here app.tar.gz' });
    await user.click(extract);
    expect(await screen.findByRole('button', { name: 'Extracting app.tar.gz' })).toHaveTextContent('Extracting…');
    await user.click(screen.getByRole('button', { name: 'Extracting app.tar.gz' }));
    expect(extractFile).toHaveBeenCalledTimes(1);
    expect(extractFile).toHaveBeenCalledWith({ rootKey: 'qc', path: 'releases/app.tar.gz' });

    resolveExtraction({ rootKey: 'qc', sourcePath: 'releases/app.tar.gz', destinationPath: 'releases/app_2' });
  });

  it('refreshes, highlights the server-returned folder, and retains the archive after extraction', async () => {
    listFiles
      .mockResolvedValueOnce([{ name: 'app.zip', type: 'file' }])
      .mockResolvedValueOnce([
        { name: 'app.zip', type: 'file' },
        { name: 'app_7', type: 'directory' },
      ]);
    extractFile.mockResolvedValue({ rootKey: 'techDrive', sourcePath: 'app.zip', destinationPath: 'app_7' });
    const user = userEvent.setup();
    render(<FileBrowser rootKey="techDrive" selected={[]} onSelectionChange={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Extract here app.zip' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Extracted to app_7');
    await waitFor(() => expect(listFiles).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('file-browser-list').querySelector('[data-path="app.zip"]')).toBeInTheDocument();
    expect(screen.getByTestId('file-browser-list').querySelector('[data-path="app_7"]')).toHaveClass('bg-emerald-50');
  });

  it.each([
    [{ status: 413, code: 'ARCHIVE_LIMIT_EXCEEDED', message: 'limit' }, 'server extraction limit'],
    [{ status: 415, code: 'UNSUPPORTED_ARCHIVE_FORMAT', message: 'format' }, 'unsupported or has been disabled'],
    [{ status: 422, code: 'INVALID_ARCHIVE', message: 'invalid' }, 'corrupt, unsafe, encrypted'],
    [{ status: 500, code: 'ARCHIVE_CLEANUP_FAILED', message: 'cleanup' }, 'could not be completely deleted'],
  ])('explains extraction failures without adding a destination', async (error, expectedMessage) => {
    listFiles.mockResolvedValue([{ name: 'app.zip', type: 'file' }]);
    extractFile.mockRejectedValue(error);
    const user = userEvent.setup();
    render(<FileBrowser rootKey="techDrive" selected={[]} onSelectionChange={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Extract here app.zip' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(expectedMessage);
    expect(listFiles).toHaveBeenCalledTimes(1);
  });

  it('refreshes a disappeared archive and reports uncertain outcomes without retrying', async () => {
    listFiles.mockResolvedValue([{ name: 'app.zip', type: 'file' }]);
    extractFile.mockRejectedValueOnce({ status: 404, code: 'SOURCE_NOT_FOUND', message: 'gone' }).mockRejectedValueOnce(new Error('network'));
    const user = userEvent.setup();
    render(<FileBrowser rootKey="techDrive" selected={[]} onSelectionChange={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Extract here app.zip' }));
    await waitFor(() => expect(listFiles).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Extract here app.zip' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The extraction result could not be confirmed. Refresh the directory before trying again.',
    );
    expect(extractFile).toHaveBeenCalledTimes(2);
  });

  it('shows lock owners and paths from a rejected extraction', async () => {
    listFiles.mockResolvedValue([{ name: 'app.zip', type: 'file' }]);
    extractFile.mockRejectedValue({
      status: 423,
      code: 'RESOURCE_LOCKED',
      message: 'The archive is locked.',
      users: ['Ada'],
      paths: ['releases/app.zip'],
    });
    const user = userEvent.setup();
    render(<FileBrowser rootKey="techDrive" selected={[]} onSelectionChange={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Extract here app.zip' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The archive is locked.');
    expect(screen.getByRole('alert')).toHaveTextContent('Users: Ada');
    expect(screen.getByRole('alert')).toHaveTextContent('releases/app.zip');
  });

  it('allows directory selection while keeping files unselectable', async () => {
    listFiles.mockResolvedValue([
      { name: 'exploded-war', type: 'directory' },
      { name: 'build.war', type: 'file', size: 100 },
    ]);
    const onSelectionChange = vi.fn();
    const user = userEvent.setup();
    render(<FileBrowser rootKey="jenkinsBuild" selectableType="directory" selected={[]} onSelectionChange={onSelectionChange} />);

    const directory = await screen.findByLabelText('Select exploded-war');
    expect(directory).toBeEnabled();
    expect(screen.getByLabelText('Select build.war')).toBeDisabled();
    await user.click(directory);

    await waitFor(() =>
      expect(onSelectionChange).toHaveBeenCalledWith(
        ['exploded-war'],
        expect.objectContaining({ relative: 'exploded-war', selected: true }),
      ),
    );
  });

  it('preserves extension pickers as file-only selectors by default', async () => {
    listFiles.mockResolvedValue([
      { name: 'nested', type: 'directory' },
      { name: 'build.war', type: 'file', size: 100 },
      { name: 'notes.txt', type: 'file', size: 20 },
      { name: 'build.zip', type: 'file', size: 100 },
    ]);
    render(<FileBrowser rootKey="techDrive" selectableExtension=".war" selected={[]} onSelectionChange={vi.fn()} />);

    expect(await screen.findByLabelText('Select nested')).toBeDisabled();
    expect(screen.getByLabelText('Select build.war')).toBeEnabled();
    expect(screen.getByLabelText('Select notes.txt')).toBeDisabled();
    expect(screen.getByLabelText('Select build.zip')).toBeDisabled();
  });

  it('accepts multiple extensions case-insensitively while excluding directories and other files', async () => {
    listFiles.mockResolvedValue([
      ...['build.war', 'build.zip', 'upper.WAR', 'upper.ZIP', 'notes.txt', 'build.zip.txt'].map((name) => ({
        name,
        type: 'file',
      })),
      { name: 'nested.zip', type: 'directory' },
    ]);
    render(<FileBrowser rootKey="techDrive" selectableExtension={['.war', '.zip']} selected={[]} onSelectionChange={vi.fn()} />);
    expect(await screen.findByLabelText('Select build.zip')).toBeEnabled();
    for (const name of ['build.war', 'upper.WAR', 'upper.ZIP']) expect(screen.getByLabelText(`Select ${name}`)).toBeEnabled();
    for (const name of ['notes.txt', 'build.zip.txt', 'nested.zip'])
      expect(screen.getByLabelText(`Select ${name}`)).toBeDisabled();
  });

  it('keeps locked entries visible but unselectable', async () => {
    listFiles.mockResolvedValue([
      { name: 'locked.xml', type: 'file', locked: true, lockMode: 'WRITE' },
      { name: 'available.xml', type: 'file' },
    ]);
    render(<FileBrowser rootKey="techDrive" selected={[]} onSelectionChange={vi.fn()} />);

    expect(await screen.findByLabelText('Select locked.xml')).toBeDisabled();
    expect(screen.getByLabelText('Select available.xml')).toBeEnabled();
    expect(screen.getByTitle('WRITE')).toBeInTheDocument();
  });

  it('shows Tech Drive provisioning failures and keeps retry available', async () => {
    listFiles.mockRejectedValue(new Error('Tech drive not present. failed to automatically create username directory'));
    const user = userEvent.setup();
    render(<FileBrowser rootKey="techDrive" selected={[]} onSelectionChange={vi.fn()} />);

    expect(
      await screen.findByText('Tech drive not present. failed to automatically create username directory'),
    ).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry).toBeEnabled();

    await user.click(retry);
    await waitFor(() => expect(listFiles).toHaveBeenCalledTimes(2));
  });

  it('disables navigation and selection while the workflow is running', async () => {
    listFiles.mockResolvedValue([{ name: 'nested', type: 'directory' }]);
    render(<FileBrowser rootKey="techDrive" selected={[]} onSelectionChange={vi.fn()} disabled />);

    expect(await screen.findByLabelText('Select nested')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'nested' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('filters current-directory files and folders from the header dropdown', async () => {
    listFiles.mockResolvedValue([
      { name: 'archive', type: 'directory' },
      { name: 'release.war', type: 'file', size: 100 },
    ]);
    const user = userEvent.setup();
    render(<FileBrowser rootKey="techDrive" selected={[]} onSelectionChange={vi.fn()} />);

    await screen.findByLabelText('Select archive');
    await user.click(screen.getByRole('combobox', { name: 'Filter files and folders' }));

    expect(screen.getByRole('option', { name: /archive/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /release\.war/i })).toBeInTheDocument();

    const input = screen.getByLabelText('Filter files and folders by name');
    await user.type(input, 'release');

    expect(screen.queryByLabelText('Select archive')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select release.war')).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: /release\.war/i }));
    expect(screen.getByLabelText('Select release.war')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Filter files and folders' }));
    await user.click(screen.getByRole('option', { name: /clear selection/i }));
    expect(screen.getByLabelText('Select archive')).toBeInTheDocument();
    expect(screen.getByLabelText('Select release.war')).toBeInTheDocument();
  });

  it('clears the filter when navigating into another directory', async () => {
    listFiles
      .mockResolvedValueOnce([{ name: 'nested', type: 'directory' }])
      .mockResolvedValueOnce([{ name: 'child.txt', type: 'file' }]);
    const user = userEvent.setup();
    render(<FileBrowser rootKey="techDrive" selected={[]} onSelectionChange={vi.fn()} />);

    await screen.findByLabelText('Select nested');
    await user.click(screen.getByRole('combobox', { name: 'Filter files and folders' }));
    await user.type(screen.getByLabelText('Filter files and folders by name'), 'nested');
    await user.click(screen.getByRole('button', { name: 'nested' }));

    expect(await screen.findByLabelText('Select child.txt')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter files and folders' })).toHaveTextContent('Filter files...');
  });

  it('opens a directory when its non-name area is clicked without starting a rename', async () => {
    listFiles
      .mockResolvedValueOnce([{ name: 'nested', type: 'directory' }])
      .mockResolvedValueOnce([{ name: 'child.txt', type: 'file' }]);
    const user = userEvent.setup();
    render(<FileBrowser rootKey="techDrive" selected={[]} onSelectionChange={vi.fn()} />);

    await screen.findByLabelText('Select nested');
    await user.click(screen.getByRole('button', { name: 'nested' }));

    expect(await screen.findByLabelText('Select child.txt')).toBeInTheDocument();
  });

  it('selects all eligible visible files and directories while preserving earlier selections', async () => {
    listFiles.mockResolvedValue([
      { name: 'nested', type: 'directory' },
      { name: 'available.xml', type: 'file' },
      { name: 'locked.xml', type: 'file', locked: true },
      { name: 'notes.txt', type: 'file' },
    ]);
    const onSelectionChange = vi.fn();
    const user = userEvent.setup();
    render(
      <FileBrowser rootKey="techDrive" showSelectAll selected={['earlier/file.txt']} onSelectionChange={onSelectionChange} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Select all' }));

    expect(onSelectionChange).toHaveBeenCalledWith(['earlier/file.txt', 'nested', 'available.xml', 'notes.txt'], {
      changes: [
        { relative: 'nested', entry: expect.objectContaining({ name: 'nested' }), selected: true },
        { relative: 'available.xml', entry: expect.objectContaining({ name: 'available.xml' }), selected: true },
        { relative: 'notes.txt', entry: expect.objectContaining({ name: 'notes.txt' }), selected: true },
      ],
    });
  });

  it('changes to Unselect all after manual selection and clears only visible eligible items', async () => {
    listFiles.mockResolvedValue([
      { name: 'nested', type: 'directory' },
      { name: 'available.xml', type: 'file' },
      { name: 'locked.xml', type: 'file', locked: true },
    ]);
    const user = userEvent.setup();
    render(<StatefulFileBrowser initialSelected={['earlier/file.txt']} showSelectAll />);

    await user.click(await screen.findByLabelText('Select nested'));
    await user.click(screen.getByLabelText('Select available.xml'));
    const unselectAll = screen.getByRole('button', { name: 'Unselect all' });
    await user.click(unselectAll);

    expect(screen.getByLabelText('Select nested')).not.toBeChecked();
    expect(screen.getByLabelText('Select available.xml')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Select all' })).toBeEnabled();
    expect(screen.getByTestId('selected-paths')).toHaveTextContent('earlier/file.txt');
  });

  it('changes to Unselect all after Select all is used', async () => {
    listFiles.mockResolvedValue([
      { name: 'nested', type: 'directory' },
      { name: 'available.xml', type: 'file' },
    ]);
    const user = userEvent.setup();
    render(<StatefulFileBrowser initialSelected={[]} showSelectAll />);

    await user.click(await screen.findByRole('button', { name: 'Select all' }));

    expect(screen.getByRole('button', { name: 'Unselect all' })).toBeEnabled();
    expect(screen.getByLabelText('Select nested')).toBeChecked();
    expect(screen.getByLabelText('Select available.xml')).toBeChecked();
  });

  it('does not expose bulk controls for Jenkins or Select all for a single picker', async () => {
    listFiles.mockResolvedValue([]);
    const { rerender } = render(<FileBrowser rootKey="jenkinsBuild" showSelectAll selected={[]} onSelectionChange={vi.fn()} />);
    await screen.findByText('This directory is empty.');

    expect(screen.queryByRole('button', { name: 'Select all' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();

    rerender(<FileBrowser rootKey="techDrive" selected={[]} onSelectionChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled());
    expect(screen.queryByRole('button', { name: 'Select all' })).not.toBeInTheDocument();
  });

  it('requires confirmation and deletes selected files through the backend', async () => {
    listFiles.mockResolvedValue([{ name: 'available.xml', type: 'file' }]);
    deleteFiles.mockResolvedValue({});
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const user = userEvent.setup();
    render(<StatefulFileBrowser initialSelected={['available.xml']} />);

    const deleteButton = await screen.findByRole('button', { name: 'Delete' });
    expect(deleteButton).toBeEnabled();
    await user.click(deleteButton);
    expect(deleteFiles).not.toHaveBeenCalled();

    await user.click(deleteButton);
    expect(confirm).toHaveBeenLastCalledWith(
      'Permanently delete 1 selected item(s)? Directories and their contents will be removed. This action cannot be undone.',
    );
    await waitFor(() => expect(deleteFiles).toHaveBeenCalledWith('techDrive', ['available.xml']));
    await waitFor(() => expect(listFiles).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Select available.xml')).not.toBeChecked();
  });

  it('keeps the selection and displays the backend error when deletion fails', async () => {
    listFiles.mockResolvedValue([{ name: 'available.xml', type: 'file' }]);
    deleteFiles.mockRejectedValue(new Error('The file is locked by another user.'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<StatefulFileBrowser initialSelected={['available.xml']} />);

    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The file is locked by another user.');
    expect(screen.getByLabelText('Select available.xml')).toBeChecked();
    expect(listFiles).toHaveBeenCalledTimes(1);
  });

  it('caps the file list height and scrolls the first selected row into view', async () => {
    listFiles.mockResolvedValue([
      { name: 'archive', type: 'directory' },
      { name: 'available.xml', type: 'file' },
    ]);
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    render(<FileBrowser rootKey="techDrive" selected={['available.xml']} onSelectionChange={vi.fn()} />);

    await screen.findByLabelText('Select available.xml');
    const list = screen.getByTestId('file-browser-list');
    expect(list).toHaveClass('max-h-[500px]', 'overflow-y-auto');
    expect(list.querySelector('[data-path="available.xml"]')).toBeInTheDocument();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' }));
  });

  it('allows a selected directory to be deleted', async () => {
    listFiles.mockResolvedValue([{ name: 'release', type: 'directory' }]);
    deleteFiles.mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<StatefulFileBrowser initialSelected={['release']} selectableType="directory" />);

    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteFiles).toHaveBeenCalledWith('techDrive', ['release']));
  });

  it('renames an entry when its inline input loses focus and retains its selection', async () => {
    listFiles.mockResolvedValue([{ name: 'available.xml', type: 'file' }]);
    let completeRename: () => void = () => undefined;
    renameFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          completeRename = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<StatefulFileBrowser initialSelected={['available.xml']} />);

    await user.click(await screen.findByTitle('Rename'));
    const input = await screen.findByRole('textbox', { name: 'Rename available.xml' });
    expect(input).toHaveValue('available');
    expect(screen.getByText('.xml')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, 'renamed');
    await user.tab();

    expect(await screen.findByText('...renaming...')).toBeInTheDocument();
    await waitFor(() =>
      expect(renameFile).toHaveBeenCalledWith({ rootKey: 'techDrive', path: 'available.xml', newName: 'renamed.xml' }),
    );
    completeRename();
    expect(await screen.findByTitle('Rename')).toHaveClass('text-blue-600');
    expect(screen.getByTestId('selected-paths')).toHaveTextContent('renamed.xml');
  });
});

type StatefulFileBrowserProps = {
  initialSelected: string[];
  selectableType?: ComponentProps<typeof FileBrowser>['selectableType'];
  showSelectAll?: boolean;
};

function StatefulFileBrowser({ initialSelected, selectableType = 'any', showSelectAll = false }: StatefulFileBrowserProps) {
  const [selected, setSelected] = useState(initialSelected);
  return (
    <>
      <FileBrowser
        rootKey="techDrive"
        selectableType={selectableType}
        showSelectAll={showSelectAll}
        selected={selected}
        onSelectionChange={setSelected}
      />
      <output data-testid="selected-paths">{selected.join('|')}</output>
    </>
  );
}
