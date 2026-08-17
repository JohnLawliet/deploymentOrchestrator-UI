import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  downloadAdditionalConfigSample: vi.fn(),
  saveBlob: vi.fn(),
}));

vi.mock('@/lib/contractApi', () => api);

import AdditionalConfigRequiredField from './AdditionalConfigRequiredField';

describe('AdditionalConfigRequiredField', () => {
  beforeEach(() => {
    api.downloadAdditionalConfigSample.mockReset();
    api.saveBlob.mockReset();
  });

  afterEach(cleanup);

  it('downloads the sample blob and saves it with the server-provided filename', async () => {
    const result = { blob: new Blob(['key = "value"']), filename: 'additionalConfig-sample.toml' };
    api.downloadAdditionalConfigSample.mockResolvedValue(result);
    const user = userEvent.setup();
    render(<AdditionalConfigRequiredField checked={false} onCheckedChange={vi.fn()} />);

    expect(screen.getByText('Download sample file')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Download sample file' }));

    await waitFor(() => expect(api.downloadAdditionalConfigSample).toHaveBeenCalledTimes(1));
    expect(api.saveBlob).toHaveBeenCalledWith(result);
  });

  it('shows a local error when the sample is missing on the server', async () => {
    api.downloadAdditionalConfigSample.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
    const user = userEvent.setup();
    render(<AdditionalConfigRequiredField checked={false} onCheckedChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Download sample file' }));

    expect(await screen.findByText('The additionalConfig sample is not available on the server.')).toBeVisible();
    expect(api.saveBlob).not.toHaveBeenCalled();
  });

  it('disables the checkbox and sample download while the field is disabled', () => {
    render(<AdditionalConfigRequiredField checked={false} disabled onCheckedChange={vi.fn()} />);

    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download sample file' })).toBeDisabled();
    expect(api.downloadAdditionalConfigSample).not.toHaveBeenCalled();
  });
});
