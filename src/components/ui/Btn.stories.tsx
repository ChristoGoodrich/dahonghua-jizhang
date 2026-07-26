import type { Meta, StoryObj } from '@storybook/react';
import { Btn } from './Btn';

const meta: Meta<typeof Btn> = {
  title: 'UI/Btn',
  component: Btn,
  argTypes: {
    variant: { control: 'radio', options: ['primary', 'ghost', 'quiet'] },
    disabled: { control: 'boolean' },
    label: { control: 'text' },
  },
  args: {
    label: 'Button',
    onPress: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof Btn>;

export const Primary: Story = {
  args: { variant: 'primary', label: 'Primary' },
};

export const Ghost: Story = {
  args: { variant: 'ghost', label: 'Ghost' },
};

export const Quiet: Story = {
  args: { variant: 'quiet', label: 'Quiet' },
};

export const Disabled: Story = {
  args: { variant: 'primary', label: 'Disabled', disabled: true },
};
