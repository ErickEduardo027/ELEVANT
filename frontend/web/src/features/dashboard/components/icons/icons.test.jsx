import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  BellIcon,
  SunIcon,
  MoonIcon,
  ChevronDownIcon,
  PlaneIcon,
  ShieldCheckIcon,
  MapPinIcon,
  AlertTriangleIcon,
  RefreshCwIcon,
  ChecklistIcon,
  UsersIcon,
  MenuIcon,
} from './index';

const ICONS = {
  BellIcon,
  SunIcon,
  MoonIcon,
  ChevronDownIcon,
  PlaneIcon,
  ShieldCheckIcon,
  MapPinIcon,
  AlertTriangleIcon,
  RefreshCwIcon,
  ChecklistIcon,
  UsersIcon,
  MenuIcon,
};

describe('icon set', () => {
  it.each(Object.entries(ICONS))('%s renders a decorative inline SVG', (name, Icon) => {
    const { container } = render(<Icon className="h-4 w-4" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveClass('h-4', 'w-4');
  });
});
