import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  loadAiCredentials,
  loadConfig,
  loadYouTubeCredentials
} from './config';

describe('loadConfig', () => {
  it('menerapkan default loopback dan timezone Jakarta', () => {
    const config = loadConfig({});

    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(4317);
    expect(config.timezone).toBe('Asia/Jakarta');
    expect(config.env).toBe('development');
    expect(config.jobMaxAttempts).toBe(3);
    expect(config.databasePath).toBe('./data/database/app.sqlite');
    expect(config.workerEnabled).toBe(true);
    expect(config.workerIntervalMs).toBe(1_000);
    expect(config.mediaRoot).toBe('./data/media');
    expect(config.schedulerEnabled).toBe(true);
    expect(config.schedulerIntervalMs).toBe(5_000);
    expect(config.youtubeAdapter).toBe('off');
    expect(config.youtubeUploadPrivacy).toBe('private');
    expect(config.youtubeAppStatus).toBe('unknown');
  });

  it('membaca privasi unggahan dan status app YouTube, menolak nilai lain', () => {
    const config = loadConfig({
      YOUTUBE_UPLOAD_PRIVACY: 'unlisted',
      YOUTUBE_APP_STATUS: 'production'
    });
    expect(config.youtubeUploadPrivacy).toBe('unlisted');
    expect(config.youtubeAppStatus).toBe('production');

    expect(() => loadConfig({ YOUTUBE_UPLOAD_PRIVACY: 'hidden' })).toThrow(ConfigError);
    expect(() => loadConfig({ YOUTUBE_APP_STATUS: 'internal' })).toThrow(ConfigError);
  });

  it('menerima adapter YouTube mock/api hanya dengan opt-in eksplisit', () => {
    expect(loadConfig({ YOUTUBE_ADAPTER: 'mock' }).youtubeAdapter).toBe('mock');
    expect(loadConfig({ YOUTUBE_ADAPTER: 'api' }).youtubeAdapter).toBe('api');
    expect(() => loadConfig({ YOUTUBE_ADAPTER: 'live' })).toThrow(ConfigError);
  });

  it('tidak menaruh kredensial OAuth di AppConfig', () => {
    const config = loadConfig({ GOOGLE_OAUTH_CLIENT_ID: 'client-uji' });
    expect(Object.keys(config)).not.toContain('googleOauthClientId');
    expect(JSON.stringify(config)).not.toContain('client-uji');
  });

  it('menolak host non-loopback tanpa APP_ALLOW_NETWORK', () => {
    expect(() => loadConfig({ APP_HOST: '0.0.0.0' })).toThrow(ConfigError);
    try {
      loadConfig({ APP_HOST: '0.0.0.0' });
    } catch (error) {
      expect((error as ConfigError).issues.join(' ')).toContain('APP_HOST');
    }
  });

  it('mengizinkan host non-loopback bila APP_ALLOW_NETWORK=true', () => {
    const config = loadConfig({ APP_HOST: '0.0.0.0', APP_ALLOW_NETWORK: 'true' });
    expect(config.host).toBe('0.0.0.0');
  });

  it('menolak port di luar rentang dan nilai non-numerik', () => {
    expect(() => loadConfig({ APP_PORT: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ APP_PORT: 'abc' })).toThrow(ConfigError);
    expect(() => loadConfig({ APP_PORT: '70000' })).toThrow(ConfigError);
  });

  it('menolak LOG_LEVEL yang tidak dikenal', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow(ConfigError);
  });

  it('menolak WORKER_INTERVAL_MS di luar rentang', () => {
    expect(() => loadConfig({ WORKER_INTERVAL_MS: '10' })).toThrow(ConfigError);
    expect(() => loadConfig({ WORKER_INTERVAL_MS: 'abc' })).toThrow(ConfigError);
    expect(() => loadConfig({ WORKER_INTERVAL_MS: '90000' })).toThrow(ConfigError);
  });

  it('mematikan worker lewat WORKER_ENABLED=false', () => {
    const config = loadConfig({ WORKER_ENABLED: 'false', WORKER_INTERVAL_MS: '250' });
    expect(config.workerEnabled).toBe(false);
    expect(config.workerIntervalMs).toBe(250);
  });

  it('mengatur dispatch jadwal lewat SCHEDULER_ENABLED dan menolak interval di luar rentang', () => {
    const config = loadConfig({ SCHEDULER_ENABLED: 'false', SCHEDULER_INTERVAL_MS: '15000' });
    expect(config.schedulerEnabled).toBe(false);
    expect(config.schedulerIntervalMs).toBe(15_000);

    expect(() => loadConfig({ SCHEDULER_INTERVAL_MS: '10' })).toThrow(ConfigError);
    expect(() => loadConfig({ SCHEDULER_INTERVAL_MS: 'abc' })).toThrow(ConfigError);
    expect(() => loadConfig({ SCHEDULER_INTERVAL_MS: '600000' })).toThrow(ConfigError);
  });

  it('tidak pernah menyimpan API key di AppConfig', () => {
    const config = loadConfig({ DEEPSEEK_API_KEY: 'sk-rahasia' });
    expect(Object.values(config)).not.toContain('sk-rahasia');
    expect('apiKey' in config).toBe(false);
  });

  it('membaca konfigurasi yang diberikan secara eksplisit', () => {
    const config = loadConfig({
      APP_ENV: 'production',
      APP_PORT: '5000',
      DATABASE_PATH: 'D:/saa/app.sqlite',
      JOB_MAX_ATTEMPTS: '5',
      LOG_LEVEL: 'silent'
    });

    expect(config).toMatchObject({
      env: 'production',
      port: 5000,
      databasePath: 'D:/saa/app.sqlite',
      jobMaxAttempts: 5,
      logLevel: 'silent'
    });
  });
});

describe('loadAiCredentials', () => {
  it('mengembalikan null bila key tidak ada atau kosong', () => {
    expect(loadAiCredentials({})).toBeNull();
    expect(loadAiCredentials({ DEEPSEEK_API_KEY: '   ' })).toBeNull();
  });

  it('memangkas spasi pada key', () => {
    expect(loadAiCredentials({ DEEPSEEK_API_KEY: '  sk-uji  ' })).toEqual({ apiKey: 'sk-uji' });
  });
});

describe('loadYouTubeCredentials', () => {
  it('mengembalikan null bila client id tidak ada', () => {
    expect(loadYouTubeCredentials({})).toBeNull();
    expect(loadYouTubeCredentials({ GOOGLE_OAUTH_CLIENT_ID: '  ' })).toBeNull();
  });

  it('memangkas client id dan memperlakukan secret kosong sebagai null', () => {
    expect(loadYouTubeCredentials({ GOOGLE_OAUTH_CLIENT_ID: '  id-uji  ' })).toEqual({
      clientId: 'id-uji',
      clientSecret: null
    });
    expect(
      loadYouTubeCredentials({
        GOOGLE_OAUTH_CLIENT_ID: 'id-uji',
        GOOGLE_OAUTH_CLIENT_SECRET: '   '
      })
    ).toEqual({ clientId: 'id-uji', clientSecret: null });
  });

  it('meneruskan client secret bila diisi', () => {
    expect(
      loadYouTubeCredentials({
        GOOGLE_OAUTH_CLIENT_ID: 'id-uji',
        GOOGLE_OAUTH_CLIENT_SECRET: '  rahasia-uji  '
      })
    ).toEqual({ clientId: 'id-uji', clientSecret: 'rahasia-uji' });
  });
});
