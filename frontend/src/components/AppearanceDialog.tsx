import { useAppStore } from '@/stores/useAppStore';
import { SelectGroupRoot, SelectGroupOption } from '@/components/ui/select-group';
import { Monitor, RotateCcw, ChevronDown, Palette } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Background from '@/components/ui/BackgroundNew';
import { useState } from 'react';
import TextColor from './ui/icons/TextColor';
import Sun from './ui/icons/Sun';
import Moon from './ui/icons/Moon';
import Computer from './ui/icons/Computer';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const BACKGROUND_IMAGES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18'];

interface AppearanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AppearanceDialog({ open, onOpenChange }: AppearanceDialogProps) {
  const {
    theme, setTheme,
    globalFontSize, setGlobalFontSize,
    backgroundMode, setBackgroundMode,
    themeVariables, setThemeVariables, resetThemeVariables
  } = useAppStore();

  const [themeVariablesExpanded, setThemeVariablesExpanded] = useState(false);
  const currentBackground = backgroundMode;
  const isLightTheme = theme === 'light' || (theme === 'system' && !window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-2 flex flex-col w-[70ch] max-w-[97%] max-h-[90svh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pl-2">
            <div className="h-5 w-5"><TextColor className='max-h-full max-w-full text-inherit'/></div>
            <div>Appearance</div>
          </DialogTitle>
        </DialogHeader>

      <div className="flex flex-col gap-5 p-2 lg:p-4 overflow-y-auto overflow-x-hidden w-full">
      {/* Theme Selector */}
      <div className="flex flex-col gap-4 w-full">
        <div className="flex flex-col gap-2">
          <Label className="text-sm font-medium">Theme</Label>
          <SelectGroupRoot className='w-fit' rounded={false} value={theme} onValueChange={(value) => setTheme(value as 'light' | 'dark' | 'system')} orientation="horizontal">
            <SelectGroupOption value="light" className='h-6'>
              <div className="h-4 w-4 mr-2">
                <Sun className="max-h-full max-w-full text-inherit" />
              </div>
              Light
            </SelectGroupOption>
            <SelectGroupOption value="dark" className='h-6'>
              <div className="h-4 w-4 mr-2">
                <Moon className="max-h-full max-w-full text-inherit" />
              </div>
              Dark
            </SelectGroupOption>
            <SelectGroupOption value="system" className='h-6'>
              <div className="h-4 w-4 mr-2">
                <Computer className="max-h-full max-w-full text-inherit" />
              </div>
              System
            </SelectGroupOption>
          </SelectGroupRoot>
        </div>

        {/* Theme Variables - Only for light theme */}
        {isLightTheme && (
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setThemeVariablesExpanded(!themeVariablesExpanded)}
              className="flex items-center justify-between w-full bg-muted/10 hover:bg-muted/20 rounded px-2 transition-colors"
            >
              <Label className="text-sm font-normal cursor-pointer">Theme Variables</Label>
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="transparent"
                      hoverVariant='default'
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        resetThemeVariables();
                      }}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reset all to defaults</TooltipContent>
                </Tooltip>
                <ChevronDown className={`h-4 w-4 transition-transform ${themeVariablesExpanded ? 'rotate-180' : ''}`} />
              </div>
            </button>

            {themeVariablesExpanded && (
              <div className="flex flex-col gap-3 px-2">
                {/* Hue */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Hue</span>
                    <span className="text-xs text-muted-foreground">{themeVariables.hue}°</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    value={themeVariables.hue}
                    onChange={(e) => setThemeVariables({ hue: Number(e.target.value) })}
                    className="w-full"
                  />
                </div>

                {/* Saturation */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Saturation</span>
                    <span className="text-xs text-muted-foreground">{themeVariables.saturation}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={themeVariables.saturation}
                    onChange={(e) => setThemeVariables({ saturation: Number(e.target.value) })}
                    className="w-full"
                  />
                </div>

                {/* Lightness */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Lightness</span>
                    <span className="text-xs text-muted-foreground">{themeVariables.lightness}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="50"
                    value={themeVariables.lightness}
                    onChange={(e) => setThemeVariables({ lightness: Number(e.target.value) })}
                    className="w-full"
                  />
                </div>

                {/* Contrast */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Contrast</span>
                    <span className="text-xs text-muted-foreground">{themeVariables.contrast.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.01"
                    value={themeVariables.contrast}
                    onChange={(e) => setThemeVariables({ contrast: Number(e.target.value) })}
                    className="w-full"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Font Size Slider */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium min-w-fit">UI Size <span className='hidden md:block'>(use CTRL+/- to change anytime)</span></Label>
          <div className="flex gap-2 items-center w-full px-2">
            <input
              type="number"
              min="5"
              max="32"
              value={globalFontSize}
              onChange={(e) => setGlobalFontSize(Number(e.target.value))}
              className="w-fit bg-background-darker px-2 rounded-md"
            />
            <button className="w-7 rounded-md bg-muted/30" onClick={() => setGlobalFontSize(globalFontSize - 1)}>-</button>
            <button className="w-7 rounded-md bg-muted/30" onClick={() => setGlobalFontSize(globalFontSize + 1)}>+</button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{globalFontSize}px</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="transparent"
                  hoverVariant='default'
                  size="icon"
                  onClick={() => setGlobalFontSize(14)}
                >
                  <RotateCcw className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reset to default (14px)</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Background Selector */}
      <div className="flex flex-col gap-3">
        <Label className="text-sm font-medium">Background</Label>

        {/* Patterns */}
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">Patterns</span>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3, 4, 5, 6].map((id) => (
              <button
                key={`pattern-${id}`}
                onClick={() => setBackgroundMode({ type: 'pattern', patternId: id as 1 | 2 | 3 | 4 })}
                className={`flex-1 h-16 rounded-lg border-2 transition-all overflow-hidden relative ${
                  currentBackground.type === 'pattern' && currentBackground.patternId === id
                    ? 'border-accent'
                    : 'border-muted hover:border-accent/50'
                }`}
              >
                <div className="absolute inset-0">
                  <Background background={{ type: 'pattern', patternId: id as 1 | 2 | 3 | 4 }} />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Background Images */}
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">Images</span>
          <div className="grid grid-cols-3 gap-2">
            {BACKGROUND_IMAGES.map((imageId) => (
              <button
                key={`image-${imageId}`}
                onClick={() => setBackgroundMode({ type: 'image', imageId })}
                className={`aspect-video rounded-lg border-2 transition-all overflow-hidden relative ${
                  currentBackground.type === 'image' && currentBackground.imageId === imageId
                    ? 'border-accent'
                    : 'border-muted hover:border-accent/50'
                }`}
              >
                <img
                  src={`${import.meta.env.BASE_URL}background${imageId}-preview.webp`}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover opacity-80"
                />
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground/50">Courtesy of <a className='text-accent/50 hover:underline' href="https://www.nga.gov/artworks/free-images-and-open-access" target="_blank">the National Gallery of Art</a></span>
        </div>

        {/* Custom URL */}
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">Custom URL</span>
          <Input
            type="text"
            placeholder="https://example.com/image.jpg"
            value={currentBackground.type === 'image' && currentBackground.url ? currentBackground.url : ''}
            onChange={(e) => {
              if (e.target.value) {
                setBackgroundMode({ type: 'image', imageId: '1', url: e.target.value });
              }
            }}
            className="w-full"
          />
        </div>
      </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
