import { describe, it, expect } from 'vitest';
import { classifyFileExtension, buildInsertText, type DroppedFile } from '../useFileDrop';

describe('classifyFileExtension', () => {
  it('classifies common image extensions', () => {
    expect(classifyFileExtension('photo.png')).toBe('image');
    expect(classifyFileExtension('photo.jpg')).toBe('image');
    expect(classifyFileExtension('photo.jpeg')).toBe('image');
    expect(classifyFileExtension('photo.gif')).toBe('image');
    expect(classifyFileExtension('icon.svg')).toBe('image');
    expect(classifyFileExtension('photo.webp')).toBe('image');
  });

  it('classifies common code/text extensions', () => {
    expect(classifyFileExtension('app.ts')).toBe('code');
    expect(classifyFileExtension('app.tsx')).toBe('code');
    expect(classifyFileExtension('index.js')).toBe('code');
    expect(classifyFileExtension('main.py')).toBe('code');
    expect(classifyFileExtension('main.go')).toBe('code');
    expect(classifyFileExtension('style.css')).toBe('code');
    expect(classifyFileExtension('config.json')).toBe('code');
    expect(classifyFileExtension('config.yaml')).toBe('code');
    expect(classifyFileExtension('readme.md')).toBe('code');
    expect(classifyFileExtension('notes.txt')).toBe('code');
    expect(classifyFileExtension('data.csv')).toBe('code');
    expect(classifyFileExtension('build.sh')).toBe('code');
    expect(classifyFileExtension('query.sql')).toBe('code');
  });

  it('returns unknown for files without extensions', () => {
    expect(classifyFileExtension('Makefile')).toBe('unknown');
    expect(classifyFileExtension('LICENSE')).toBe('unknown');
  });

  it('returns unknown for unrecognized extensions', () => {
    expect(classifyFileExtension('archive.zip')).toBe('unknown');
    expect(classifyFileExtension('binary.exe')).toBe('unknown');
    expect(classifyFileExtension('document.pdf')).toBe('unknown');
  });

  it('is case-insensitive', () => {
    expect(classifyFileExtension('Photo.PNG')).toBe('image');
    expect(classifyFileExtension('App.TSX')).toBe('code');
    expect(classifyFileExtension('IMAGE.JPEG')).toBe('image');
  });
});

describe('buildInsertText', () => {
  const makeFile = (overrides: Partial<DroppedFile>): DroppedFile => ({
    kind: 'code',
    name: 'test.ts',
    path: 'src/test.ts',
    file: new File([''], 'test.ts'),
    ...overrides,
  });

  it('builds @mention for code files', () => {
    const result = buildInsertText(makeFile({ kind: 'code', path: 'src/utils.ts' }));
    expect(result).toBe('@src/utils.ts');
  });

  it('builds @mention for unknown files', () => {
    const result = buildInsertText(makeFile({ kind: 'unknown', name: 'Makefile', path: 'Makefile' }));
    expect(result).toBe('@Makefile');
  });

  it('builds image markdown for image files with dataUrl', () => {
    const result = buildInsertText(makeFile({
      kind: 'image',
      name: 'screenshot.png',
      path: 'screenshot.png',
      dataUrl: 'data:image/png;base64,abc123',
    }));
    expect(result).toBe('![screenshot.png](data:image/png;base64,abc123)');
  });

  it('falls back to @mention for image files without dataUrl', () => {
    const result = buildInsertText(makeFile({
      kind: 'image',
      name: 'photo.jpg',
      path: 'photo.jpg',
      dataUrl: undefined,
    }));
    expect(result).toBe('@photo.jpg');
  });

  it('uses name when path is empty', () => {
    const result = buildInsertText(makeFile({ kind: 'code', name: 'app.js', path: '' }));
    expect(result).toBe('@app.js');
  });
});
