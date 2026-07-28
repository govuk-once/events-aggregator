import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';

const {
  sendMock,
  loggerInfoMock,
  loggerDebugMock,
  loggerErrorMock,
  loggerWarnMock,
} = vi.hoisted(() => ({
  sendMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class {
    send = sendMock;
  },

  GetParametersByPathCommand: class {
    input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
}));

vi.mock('@aws-lambda-powertools/logger', () => ({
  Logger: class {
    info = loggerInfoMock;
    debug = loggerDebugMock;
    error = loggerErrorMock;
    warn = loggerWarnMock;
  },
}));

const mockSsmClient = async () => {
  return import('./ssm-client.js');
};

describe('getParameter', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.SSM_PREFIX = 'ea-dev';
  });

  afterEach(() => {
    delete process.env.SSM_PREFIX;
  });

  it('retrieves a parameter from SSM', async () => {
    sendMock.mockResolvedValueOnce({
      Parameters: [
        {
          Name: '/ea-dev/uns-api-url',
          Value: 'https://uns.example.gov.uk',
        },
      ],
    });

    const { getParameter, SsmParameters } = await mockSsmClient();

    const result = await getParameter(SsmParameters.UnsApiUrl);

    expect(result).toBe('https://uns.example.gov.uk');

    expect(sendMock).toHaveBeenCalledTimes(1);

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          Path: '/ea-dev/',
          Recursive: true,
          WithDecryption: true,
          MaxResults: 10,
          NextToken: undefined,
        },
      }),
    );
  });

  it('removes leading and trailing slashes from SSM_PREFIX', async () => {
    process.env.SSM_PREFIX = '/ea-dev/';

    sendMock.mockResolvedValueOnce({
      Parameters: [
        {
          Name: '/ea-dev/uns-api-url',
          Value: 'https://uns.example.gov.uk',
        },
      ],
    });

    const { getParameter, SsmParameters } = await mockSsmClient();

    await getParameter(SsmParameters.UnsApiUrl);

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Path: '/ea-dev/',
        }),
      }),
    );
  });

  it('returns the cached value without calling SSM again', async () => {
    sendMock.mockResolvedValueOnce({
      Parameters: [
        {
          Name: '/ea-dev/uns-api-url',
          Value: 'https://uns.example.gov.uk',
        },
      ],
    });

    const { getParameter, SsmParameters } = await mockSsmClient();

    const firstResult = await getParameter(SsmParameters.UnsApiUrl);
    const secondResult = await getParameter(SsmParameters.UnsApiUrl);

    expect(firstResult).toBe('https://uns.example.gov.uk');
    expect(secondResult).toBe('https://uns.example.gov.uk');

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('caches all parameters returned by GetParametersByPath', async () => {
    sendMock.mockResolvedValueOnce({
      Parameters: [
        {
          Name: '/ea-dev/uns-api-url',
          Value: 'https://uns.example.gov.uk',
        },
        {
          Name: '/ea-dev/uns-mtls-cert-arn',
          Value:
            'arn:aws:secretsmanager:eu-west-2:123456789012:secret:uns-cert',
        },
      ],
    });

    const { getParameter, SsmParameters } = await mockSsmClient();

    const apiUrl = await getParameter(SsmParameters.UnsApiUrl);
    const certArn = await getParameter(SsmParameters.UnsMtlsCertArn);

    expect(apiUrl).toBe('https://uns.example.gov.uk');

    expect(certArn).toBe(
      'arn:aws:secretsmanager:eu-west-2:123456789012:secret:uns-cert',
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('retrieves all pages when SSM returns a NextToken', async () => {
    sendMock
      .mockResolvedValueOnce({
        Parameters: [
          {
            Name: '/ea-dev/uns-api-url',
            Value: 'https://uns.example.gov.uk',
          },
        ],
        NextToken: 'next-page-token',
      })
      .mockResolvedValueOnce({
        Parameters: [
          {
            Name: '/ea-dev/uns-mtls-key-arn',
            Value:
              'arn:aws:secretsmanager:eu-west-2:123456789012:secret:uns-key',
          },
        ],
      });

    const { getParameter, SsmParameters } = await mockSsmClient();

    const result = await getParameter(SsmParameters.UnsMtlsKeyArn);

    expect(result).toBe(
      'arn:aws:secretsmanager:eu-west-2:123456789012:secret:uns-key',
    );

    expect(sendMock).toHaveBeenCalledTimes(2);

    expect(sendMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        input: expect.objectContaining({
          NextToken: 'next-page-token',
        }),
      }),
    );
  });

  it('throws when SSM_PREFIX is not configured', async () => {
    delete process.env.SSM_PREFIX;

    const { getParameter, SsmParameters } = await mockSsmClient();

    await expect(getParameter(SsmParameters.UnsApiUrl)).rejects.toThrow(
      'SSM_PREFIX environment variable is not set',
    );

    expect(sendMock).not.toHaveBeenCalled();
  });

  it('throws when the requested parameter is not returned by SSM', async () => {
    sendMock.mockResolvedValueOnce({
      Parameters: [
        {
          Name: '/ea-dev/govuk-feed-url',
          Value: 'https://www.gov.uk/foreign-travel-advice.atom',
        },
      ],
    });

    const { getParameter, SsmParameters } = await mockSsmClient();

    await expect(getParameter(SsmParameters.UnsApiUrl)).rejects.toThrow(
      'SSM parameter not found: /ea-dev/uns-api-url',
    );
  });

  it('propagates errors returned by SSM', async () => {
    sendMock.mockRejectedValueOnce(new Error('SSM is unavailable'));

    const { getParameter, SsmParameters } = await mockSsmClient();

    await expect(getParameter(SsmParameters.UnsApiUrl)).rejects.toThrow(
      'SSM is unavailable',
    );
  });

  it('uses one refresh when concurrent calls are made', async () => {
    let resolveRequest:
      | ((value: {
          Parameters: Array<{
            Name: string;
            Value: string;
          }>;
        }) => void)
      | undefined;

    sendMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );

    const { getParameter, SsmParameters } = await mockSsmClient();

    const firstRequest = getParameter(SsmParameters.UnsApiUrl);

    const secondRequest = getParameter(SsmParameters.UnsApiUrl);

    resolveRequest?.({
      Parameters: [
        {
          Name: '/ea-dev/uns-api-url',
          Value: 'https://uns.example.gov.uk',
        },
      ],
    });

    await expect(firstRequest).resolves.toBe('https://uns.example.gov.uk');

    await expect(secondRequest).resolves.toBe('https://uns.example.gov.uk');

    expect(sendMock).toHaveBeenCalledTimes(1);

    expect(loggerInfoMock).toHaveBeenCalledWith(
      'Waiting for in-progress SSM cache refresh',
    );
  });
});
