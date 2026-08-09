import { describe, expect, it } from 'vitest';
import { canExecuteWarHotfix, displayUploadItemName, duplicateUploadItemNames } from './uploadContract';
import { uploadItem, uploadResponse } from '@/test/factories';
import type { UploadItem } from '@/types/api-contracts';

describe('upload contract helpers', () => {
  const items: UploadItem[] = [
    uploadItem({
      sourcePath: 'hotfix/one/config.properties',
      name: 'config.properties',
      status: 'AMBIGUOUS',
      candidates: ['WEB-INF/classes/a/config.properties'],
    }),
    uploadItem({
      sourcePath: 'hotfix/two/config.properties',
      name: 'config.properties',
      status: 'AMBIGUOUS',
      candidates: ['WEB-INF/classes/b/config.properties'],
    }),
    uploadItem({ sourcePath: 'hotfix/missing.xml', name: 'missing.xml', status: 'MISSING' }),
  ];

  it('identifies duplicate basenames but displays their full source identities', () => {
    const duplicates = duplicateUploadItemNames(items);
    expect(displayUploadItemName(items[0], duplicates)).toBe('config.properties (hotfix/one/config.properties)');
    expect(displayUploadItemName(items[1], duplicates)).toBe('config.properties (hotfix/two/config.properties)');
  });

  it('requires every ambiguous sourcePath to have its own valid candidate', () => {
    expect(
      canExecuteWarHotfix(uploadResponse({ items }), {
        'hotfix/one/config.properties': 'WEB-INF/classes/a/config.properties',
      }),
    ).toBe(false);
    expect(
      canExecuteWarHotfix(uploadResponse({ items }), {
        'hotfix/one/config.properties': 'WEB-INF/classes/a/config.properties',
        'hotfix/two/config.properties': 'WEB-INF/classes/b/config.properties',
      }),
    ).toBe(true);
  });
});
