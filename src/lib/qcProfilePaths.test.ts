import { describe, expect, it } from 'vitest';
import {
  archiveFormatForRequest,
  archiveFormatOptions,
  defaultArchiveFormat,
  fileMovePhaseLabel,
  previewArchiveFileName,
  sharedProfileBasePath,
  toQcRelative,
} from './qcProfilePaths';

describe('toQcRelative', () => {
  it('maps absolute paths under the QC root to relative paths', () => {
    expect(toQcRelative('D:/qc/wildfly/CoinDCX', 'D:/qc')).toBe('wildfly/CoinDCX');
    expect(toQcRelative('D:\\qc\\wildfly\\CoinDCX', 'D:/qc')).toBe('wildfly/CoinDCX');
  });

  it('is case-insensitive for Windows roots', () => {
    expect(toQcRelative('d:/QC/profiles/a', 'D:/qc')).toBe('profiles/a');
  });

  it('returns . when absolute equals QC root', () => {
    expect(toQcRelative('D:/qc', 'D:/qc')).toBe('.');
  });

  it('returns null when outside the QC root', () => {
    expect(toQcRelative('E:/other/profile', 'D:/qc')).toBeNull();
    expect(toQcRelative('D:/qc-extra/profile', 'D:/qc')).toBeNull();
  });
});

describe('sharedProfileBasePath', () => {
  const qcRoot = 'D:/qc';
  const profiles = [
    'D:/qc/wildfly-26.1.3.Final_profiles/CoinDCXP2P21X',
    'D:/qc/wildfly-26.1.3.Final_profiles/OtherApp',
    'D:/outside/not-under-qc',
  ];

  it('returns the shared profile prefix when all sources are under one profile', () => {
    expect(sharedProfileBasePath(['wildfly-26.1.3.Final_profiles/CoinDCXP2P21X/deployments/app.war'], profiles, qcRoot)).toBe(
      'wildfly-26.1.3.Final_profiles/CoinDCXP2P21X',
    );
  });

  it('prefers the longest covering profile when nested', () => {
    expect(
      sharedProfileBasePath(
        ['wildfly-26.1.3.Final_profiles/CoinDCXP2P21X/nested/file.txt'],
        [...profiles, 'D:/qc/wildfly-26.1.3.Final_profiles/CoinDCXP2P21X/nested'],
        qcRoot,
      ),
    ).toBe('wildfly-26.1.3.Final_profiles/CoinDCXP2P21X/nested');
  });

  it('returns null when sources span different profiles', () => {
    expect(
      sharedProfileBasePath(
        ['wildfly-26.1.3.Final_profiles/CoinDCXP2P21X/a.txt', 'wildfly-26.1.3.Final_profiles/OtherApp/b.txt'],
        profiles,
        qcRoot,
      ),
    ).toBeNull();
  });

  it('returns null when sources are not under any profile', () => {
    expect(sharedProfileBasePath(['lib/a.jar'], profiles, qcRoot)).toBeNull();
  });
});

describe('archive format helpers', () => {
  it('offers Move as-is only for same-root and defaults to NONE', () => {
    expect(archiveFormatOptions('qc', 'qc')).toEqual(['NONE', 'ZIP', 'WAR', 'JAR']);
    expect(defaultArchiveFormat('qc', 'qc')).toBe('NONE');
    expect(archiveFormatForRequest('NONE', 'qc', 'qc')).toBe('NONE');
    expect(archiveFormatForRequest('WAR', 'qc', 'qc')).toBe('WAR');
  });

  it('requires Zip/War/Jar for qc→techDrive and defaults to ZIP', () => {
    expect(archiveFormatOptions('qc', 'techDrive')).toEqual(['ZIP', 'WAR', 'JAR']);
    expect(defaultArchiveFormat('qc', 'techDrive')).toBe('ZIP');
    expect(archiveFormatForRequest('NONE', 'qc', 'techDrive')).toBe('ZIP');
    expect(archiveFormatForRequest('JAR', 'qc', 'techDrive')).toBe('JAR');
  });

  it('previews archive basenames with strip+append', () => {
    expect(previewArchiveFileName('profiles/app/deployments/App.war', 'WAR')).toBe('App.war');
    expect(previewArchiveFileName('bundle', 'ZIP')).toBe('bundle.zip');
    expect(previewArchiveFileName('pkg.tar.gz', 'JAR')).toBe('pkg.jar');
  });

  it('maps file move phase codes to labels', () => {
    expect(fileMovePhaseLabel('FILE_MOVE_ZIPPING')).toBe('Zipping');
    expect(fileMovePhaseLabel('FILE_MOVE_TRANSFERRING')).toBe('Transferring');
    expect(fileMovePhaseLabel('FILE_MOVE_EXTRACTING')).toBeNull();
  });
});
