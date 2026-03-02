import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the hook so we can control its return values
const mockPromptInstall = vi.fn().mockResolvedValue(undefined);
const mockUseInstallPrompt = vi.fn().mockReturnValue({
  canInstall: false,
  isInstalled: false,
  promptInstall: mockPromptInstall,
});

vi.mock('../hooks/useInstallPrompt', () => ({
  useInstallPrompt: (...args: unknown[]) => mockUseInstallPrompt(...args),
}));

import { InstallPromptBanner } from './InstallPromptBanner';

describe('InstallPromptBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    mockPromptInstall.mockClear();
    mockUseInstallPrompt.mockReturnValue({
      canInstall: false,
      isInstalled: false,
      promptInstall: mockPromptInstall,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when canInstall is false', () => {
    const { container } = render(<InstallPromptBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when app is already installed', () => {
    mockUseInstallPrompt.mockReturnValue({
      canInstall: true,
      isInstalled: true,
      promptInstall: mockPromptInstall,
    });

    const { container } = render(<InstallPromptBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the banner when canInstall is true and not dismissed', () => {
    mockUseInstallPrompt.mockReturnValue({
      canInstall: true,
      isInstalled: false,
      promptInstall: mockPromptInstall,
    });

    render(<InstallPromptBanner />);

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByText(/Install CashTrace/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install CashTrace application' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss install banner' })).toBeInTheDocument();
  });

  it('calls promptInstall when Install button is clicked', async () => {
    const user = userEvent.setup();
    mockUseInstallPrompt.mockReturnValue({
      canInstall: true,
      isInstalled: false,
      promptInstall: mockPromptInstall,
    });

    render(<InstallPromptBanner />);

    await user.click(screen.getByRole('button', { name: 'Install CashTrace application' }));

    expect(mockPromptInstall).toHaveBeenCalledOnce();
  });

  it('hides banner and persists dismissal to localStorage', async () => {
    const user = userEvent.setup();
    mockUseInstallPrompt.mockReturnValue({
      canInstall: true,
      isInstalled: false,
      promptInstall: mockPromptInstall,
    });

    render(<InstallPromptBanner />);
    expect(screen.getByRole('banner')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dismiss install banner' }));

    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(localStorage.getItem('cashtrace-install-banner-dismissed')).toBe('true');
  });

  it('does not show banner when previously dismissed', () => {
    localStorage.setItem('cashtrace-install-banner-dismissed', 'true');
    mockUseInstallPrompt.mockReturnValue({
      canInstall: true,
      isInstalled: false,
      promptInstall: mockPromptInstall,
    });

    const { container } = render(<InstallPromptBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('has proper accessibility attributes', () => {
    mockUseInstallPrompt.mockReturnValue({
      canInstall: true,
      isInstalled: false,
      promptInstall: mockPromptInstall,
    });

    render(<InstallPromptBanner />);

    const banner = screen.getByRole('banner');
    expect(banner).toHaveAttribute('aria-label', 'Install application');
  });
});
