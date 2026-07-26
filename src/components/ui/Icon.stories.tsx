import type { Meta, StoryObj } from '@storybook/react';
import { View } from 'react-native';
import { Icon, type IconName } from './Icon';

const ICON_NAMES: IconName[] = [
  'search', 'close', 'sliders', 'globe',
  'chevL', 'chevR', 'plus', 'minus',
  'trash', 'edit', 'check', 'swap',
  'sun', 'moon', 'sparkle', 'receipt', 'undo',
  'sprout', 'bolt', 'tag', 'repeat', 'download', 'bell',
  'cloud', 'archive', 'mail', 'wallet', 'card', 'layers',
  'eye', 'eyeOff', 'camera', 'gallery', 'lock',
];

const meta: Meta<typeof Icon> = {
  title: 'UI/Icon',
  component: Icon,
  argTypes: {
    name: { control: 'select', options: ICON_NAMES },
    color: { control: 'color' },
    size: { control: { type: 'range', min: 12, max: 64, step: 2 } },
    strokeWidth: { control: { type: 'range', min: 1, max: 3, step: 0.2 } },
  },
  args: {
    name: 'search',
    color: '#2B2622',
    size: 24,
  },
};

export default meta;
type Story = StoryObj<typeof Icon>;

export const Default: Story = {};

export const AllIcons: Story = {
  args: { name: 'search', size: 24, color: '#2B2622' },
  render: (args) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, padding: 16 }}>
      {ICON_NAMES.map((name) => (
        <View key={name} style={{ alignItems: 'center', gap: 4 }}>
          <Icon {...args} name={name} />
        </View>
      ))}
    </View>
  ),
};
