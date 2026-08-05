import { useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listFiles = vi.hoisted(() => vi.fn());
const deleteFiles = vi.hoisted(() => vi.fn());
vi.mock('@/lib/contractApi', () => ({ deleteFiles, listFiles }));

import FileBrowser from './FileBrowser';

describe('FileBrowser selectableType', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    listFiles.mockReset();
    deleteFiles.mockReset();
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
    ]);
    render(<FileBrowser rootKey="techDrive" selectableExtension=".war" selected={[]} onSelectionChange={vi.fn()} />);

    expect(await screen.findByLabelText('Select nested')).toBeDisabled();
    expect(screen.getByLabelText('Select build.war')).toBeEnabled();
    expect(screen.getByLabelText('Select notes.txt')).toBeDisabled();
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
    expect(screen.getByRole('button', { name: 'nested' })).toBeDisabled();
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

  it('allows a selected directory to be deleted', async () => {
    listFiles.mockResolvedValue([{ name: 'release', type: 'directory' }]);
    deleteFiles.mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<StatefulFileBrowser initialSelected={['release']} selectableType="directory" />);

    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteFiles).toHaveBeenCalledWith('techDrive', ['release']));
  });
});

function StatefulFileBrowser({ initialSelected, selectableType = 'any', showSelectAll = false }) {
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
