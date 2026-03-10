import { describe, it, expect } from 'vitest';
import { classifyFileExtension, MAX_IMAGE_SIZE } from '../useFileDrop';

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

describe('MAX_IMAGE_SIZE', () => {
  it('is set to 10 MB', () => {
    expect(MAX_IMAGE_SIZE).toBe(10 * 1024 * 1024);
  });

  it('is exported so consumers can reference the limit', () => {
    expect(typeof MAX_IMAGE_SIZE).toBe('number');
    expect(MAX_IMAGE_SIZE).toBeGreaterThan(0);
  });
});
