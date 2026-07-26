import type { Meta, StoryObj } from '@storybook/react';
import { Chip } from './Chip';

const meta: Meta<typeof Chip> = {
  title: 'UI/Chip',
  component: Chip,
  argTypes: {
    on: { control: 'boolean' },
    size: { control: 'radio', options: ['sm', 'md'] },
    dashed: { control: 'boolean' },
    label: { control: 'text' },
  },
  args: {
    label: 'Chip',
    onPress: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof Chip>;

export const Default: Story = {
  args: { label: 'Default' },
};

export const Selected: Story = {
  args: { label: 'Selected', on: true },
};

export const Small: Story = {
  args: { label: 'Small', size: 'sm' },
};

export const Medium: Story = {
  args: { label: 'Medium', size: 'md' },
};

export const Dashed: Story = {
  args: { label: 'Dashed', dashed: true },
};
