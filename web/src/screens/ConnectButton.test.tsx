import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectButton } from './ConnectButton';
import { api, ApiError } from '../api';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, api: { pairingLink: vi.fn() } };
});

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('ConnectButton', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches the link only when tapped, then opens it', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    mocked.pairingLink.mockResolvedValue({
      link: 'art://1.2.3.4:47989?pin=1234&passphrase=abcd1234&name=PC',
      pin: '1234',
      passphrase: 'abcd1234',
      expiresInSeconds: 180
    });

    render(<ConnectButton />);
    expect(mocked.pairingLink).not.toHaveBeenCalled();

    screen.getByRole('button', { name: /connect/i }).click();

    await waitFor(() => expect(assign).toHaveBeenCalledWith(expect.stringContaining('art://')));
    expect(await screen.findByText('1234')).toBeInTheDocument();
    expect(screen.getByText('abcd1234')).toBeInTheDocument();
  });

  it('drops the stale PIN when a later attempt fails', async () => {
    vi.stubGlobal('location', { assign: vi.fn() });
    mocked.pairingLink
      .mockResolvedValueOnce({ link: 'art://1.2.3.4:47989?pin=1234', pin: '1234', passphrase: 'abcd1234', expiresInSeconds: 180 })
      .mockRejectedValue(new ApiError(409, 'VM is not ready for pairing'));

    render(<ConnectButton />);
    screen.getByRole('button', { name: /connect/i }).click();
    expect(await screen.findByText('1234')).toBeInTheDocument();

    screen.getByRole('button', { name: /connect/i }).click();
    expect(await screen.findByText(/vm is not ready for pairing/i)).toBeInTheDocument();
    expect(screen.queryByText('1234')).not.toBeInTheDocument();
  });

  it('offers a retry when the link has expired or the VM is not ready', async () => {
    mocked.pairingLink.mockRejectedValue(new ApiError(409, 'VM is not ready for pairing'));
    render(<ConnectButton />);
    screen.getByRole('button', { name: /connect/i }).click();
    expect(await screen.findByText(/vm is not ready for pairing/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect/i })).toBeEnabled();
  });
});
