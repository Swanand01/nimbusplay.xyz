import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('is a real button with an accessible name', () => {
    render(<Button onClick={() => {}}>Start gaming</Button>);
    expect(screen.getByRole('button', { name: 'Start gaming' })).toBeInTheDocument();
  });

  it('does not fire when disabled', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Start gaming</Button>);
    screen.getByRole('button').click();
    expect(onClick).not.toHaveBeenCalled();
  });
});
