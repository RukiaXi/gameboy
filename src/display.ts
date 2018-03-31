import { CPU, SpecialRegister, Interrupt } from "./cpu";
const document = require("./browser.js");

const GameboyColorPalette = [
    0xEB, 0xC4, 0x60, 0x00
];

enum DisplayRegister {
    LCDC,
    STAT,
    SCY,
    SCX,
    LY,
    LYC,
    DMA,
    BGP,
    OBP0,
    OBP1,
    WY,
    WX,

    //GBC
    BCPS,
    BCPD,
    OCPS,
    OCPD,
    HDMA1,
    HDMA2,
    HDMA3,
    HDMA4,
    HDMA5
}

enum DisplayMode {
    HBlank,
    VBlank,
    ReadingOAM,
    ReadingOAMVRAM
}

interface Color {
    red: number;
    green: number;
    blue: number;
}

interface ColorPalette {
    color: Color[];
}

export class Display {
    private _cpu: CPU;
    private _registers: Uint8Array;
    private _context;
    private _data;

    private _backgroundTilemap: number;
    private _windowTilemap: number;
    private _activeTileset: number;
    private _framebuffer: Uint8ClampedArray;
    private _priorityBuffer: boolean[];
    private _cycles: number;
    private _cyclesExtra: number;
    private _vblank: number;
    private _scanlineTransferred: boolean;

    private _backgroundPalette: ColorPalette[];
    private _spritePalette: ColorPalette[];
    private _gbcMode: boolean;

    constructor(cpu: CPU) {
        this._cpu = cpu;
        this._registers = new Uint8Array(DisplayRegister.HDMA5 + 1);
        this._cycles = 0;
        this._cyclesExtra = 0;
        this._vblank = 0;
        this._scanlineTransferred = false;
        this._gbcMode = false;

        this._backgroundPalette = [];
        this._spritePalette = [];

        for (let i = 0; i <= 0x07; i++) {
            this._backgroundPalette.push({
                color: [
                    { red: 0x1F, green: 0x1F, blue: 0x1F },
                    { red: 0x1F, green: 0x1F, blue: 0x1F },
                    { red: 0x1F, green: 0x1F, blue: 0x1F },
                    { red: 0x1F, green: 0x1F, blue: 0x1F }
                ]
            });

            this._spritePalette.push({
                color: [
                    { red: 0x1F, green: 0x1F, blue: 0x1F },
                    { red: 0x1F, green: 0x1F, blue: 0x1F },
                    { red: 0x1F, green: 0x1F, blue: 0x1F },
                    { red: 0x1F, green: 0x1F, blue: 0x1F }
                ]
            });
        }

        this._cpu.MMU.addRegister(0xFF40, this._readRegister.bind(this, DisplayRegister.LCDC), this._writeRegister.bind(this, DisplayRegister.LCDC));
        this._cpu.MMU.addRegister(0xFF41, this._readRegister.bind(this, DisplayRegister.STAT), this._writeRegister.bind(this, DisplayRegister.STAT));
        this._cpu.MMU.addRegister(0xFF42, this._readRegister.bind(this, DisplayRegister.SCY), this._writeRegister.bind(this, DisplayRegister.SCY));
        this._cpu.MMU.addRegister(0xFF43, this._readRegister.bind(this, DisplayRegister.SCX), this._writeRegister.bind(this, DisplayRegister.SCX));
        this._cpu.MMU.addRegister(0xFF44, this._readRegister.bind(this, DisplayRegister.LY), this._writeRegister.bind(this, DisplayRegister.LY));
        this._cpu.MMU.addRegister(0xFF45, this._readRegister.bind(this, DisplayRegister.LYC), this._writeRegister.bind(this, DisplayRegister.LYC));
        this._cpu.MMU.addRegister(0xFF46, this._readRegister.bind(this, DisplayRegister.DMA), this._writeRegister.bind(this, DisplayRegister.DMA));
        this._cpu.MMU.addRegister(0xFF47, this._readRegister.bind(this, DisplayRegister.BGP), this._writeRegister.bind(this, DisplayRegister.BGP));
        this._cpu.MMU.addRegister(0xFF48, this._readRegister.bind(this, DisplayRegister.OBP0), this._writeRegister.bind(this, DisplayRegister.OBP0));
        this._cpu.MMU.addRegister(0xFF49, this._readRegister.bind(this, DisplayRegister.OBP1), this._writeRegister.bind(this, DisplayRegister.OBP1));
        this._cpu.MMU.addRegister(0xFF4A, this._readRegister.bind(this, DisplayRegister.WY), this._writeRegister.bind(this, DisplayRegister.WY));
        this._cpu.MMU.addRegister(0xFF4B, this._readRegister.bind(this, DisplayRegister.WX), this._writeRegister.bind(this, DisplayRegister.WX));

        //GBC
        this._cpu.MMU.addRegister(0xFF51, this._readRegister.bind(this, DisplayRegister.HDMA1), this._writeRegister.bind(this, DisplayRegister.HDMA1));
        this._cpu.MMU.addRegister(0xFF52, this._readRegister.bind(this, DisplayRegister.HDMA2), this._writeRegister.bind(this, DisplayRegister.HDMA2));
        this._cpu.MMU.addRegister(0xFF53, this._readRegister.bind(this, DisplayRegister.HDMA3), this._writeRegister.bind(this, DisplayRegister.HDMA3));
        this._cpu.MMU.addRegister(0xFF54, this._readRegister.bind(this, DisplayRegister.HDMA4), this._writeRegister.bind(this, DisplayRegister.HDMA4));
        this._cpu.MMU.addRegister(0xFF55, this._readRegister.bind(this, DisplayRegister.HDMA5), this._writeRegister.bind(this, DisplayRegister.HDMA5));
        this._cpu.MMU.addRegister(0xFF68, this._readRegister.bind(this, DisplayRegister.BCPS), this._writeRegister.bind(this, DisplayRegister.BCPS));
        this._cpu.MMU.addRegister(0xFF69, this._readRegister.bind(this, DisplayRegister.BCPD), this._writeRegister.bind(this, DisplayRegister.BCPD));
        this._cpu.MMU.addRegister(0xFF6A, this._readRegister.bind(this, DisplayRegister.OCPS), this._writeRegister.bind(this, DisplayRegister.OCPS));
        this._cpu.MMU.addRegister(0xFF6B, this._readRegister.bind(this, DisplayRegister.OCPD), this._writeRegister.bind(this, DisplayRegister.OCPD));

        const tmp = document.createElement("canvas");
        tmp.style.width = "160px";
        tmp.style.height = "144px";
        tmp.width = 160;
        tmp.height = 144;
        this._context = tmp.getContext("2d");
        this._context.fillStyle = "#dddddd";
        this._context.fillRect(0, 0, 160, 144);
        this._context.imageSmoothingEnabled = false;
        this._data = this._context.createImageData(160, 144);
        this._framebuffer = this._data.data;

        // this._framebuffer = new Uint8ClampedArray(160 * 144 * 4);

        for (let i = 0; i < (160 * 144 * 4); i += 4) {
            this._framebuffer[i + 0] = 235;
            this._framebuffer[i + 1] = 235;
            this._framebuffer[i + 2] = 235;
            this._framebuffer[i + 3] = 255;
        }

        this._priorityBuffer = Array(160 * 144).fill(false);

        this.BGP = 0xFC;
        this.SCX = 0;
        this.SCY = 0;
        this.WX = 0;
        this.WY = 0;
        this.LY = 0x91;

        this._registers[DisplayRegister.HDMA1] = 0;
        this._registers[DisplayRegister.HDMA2] = 0;
        this._registers[DisplayRegister.HDMA3] = 0;
        this._registers[DisplayRegister.HDMA4] = 0;
        this._registers[DisplayRegister.HDMA5] = 1 << 7;

        document.getElementById("emulator").appendChild(tmp);
    }

    public tick(delta: number) {
        const control = this._readRegister(DisplayRegister.LCDC);

        if (!(control & (1 << 7))) {
            this.LY = 0;
            this.mode = 0;
            this._cycles = 0;
            return;
        }

        this._backgroundTilemap = (control & (1 << 3)) ? 1 : 0;
        this._windowTilemap = (control & (1 << 6)) ? 1 : 0;
        this._activeTileset = (control & (1 << 4)) ? 1 : 0;
        this._cycles += delta;
        this._cyclesExtra += delta;

        switch (this.mode) {
            case DisplayMode.HBlank:
                if (this._cycles >= 204) {
                    this._cycles -= 204;
                    this.LY++;

                    if (this.LY === this.LYC) {
                        this.STAT |= 1 << 2;
                    } else {
                        this.STAT &= ~(1 << 2);
                    }

                    if (this.LY === 144) {
                        this._render();
                        this._vblank = 0;

                        this.mode = DisplayMode.VBlank;
                        this._cpu.requestInterrupt(Interrupt.VBlank);

                        if ((this.STAT & (1 << 4)) !== 0) {
                            this._cpu.requestInterrupt(Interrupt.LCDStat);
                        }
                    } else {
                        if ((this.STAT & (1 << 5)) !== 0) {
                            this._cpu.requestInterrupt(Interrupt.LCDStat);
                        }

                        if ((this.STAT & (1 << 6)) !== 0 && this.LY === this.LYC) {
                            this._cpu.requestInterrupt(Interrupt.LCDStat);
                        }

                        this.mode = DisplayMode.ReadingOAM;
                    }
                }
                break;

            case DisplayMode.VBlank:
                while (this._cyclesExtra > 456) {
                    this._cyclesExtra -= 456;
                    this._vblank++;
                }

                if (this._cycles >= 4560) {
                    this._cycles -= 4560;
                    this.mode = DisplayMode.ReadingOAM;
                }
                break;

            case DisplayMode.ReadingOAM:
                if (this._cycles >= 80) {
                    this._cycles -= 80;
                    this._scanlineTransferred = false;
                    this.mode = DisplayMode.ReadingOAMVRAM;
                }
                break;

            case DisplayMode.ReadingOAMVRAM:
                if (this._cycles >= 160 && !this._scanlineTransferred) {
                    this._renderScanline();
                    this._scanlineTransferred = true;
                }

                if (this._cycles >= 172) {
                    this._cycles -= 172;
                    this.mode = DisplayMode.HBlank;

                    if ((this.STAT & (1 << 3)) !== 0) {
                        this._cpu.requestInterrupt(Interrupt.LCDStat);
                    }
                }
                break;
        }
    }

    private setColorPaletteIndex(data: number, background: boolean): void {
        this._gbcMode = true;

        const hl = (data & 0x1) != 0;
        const index = (data >> 1) & 0x03;
        const pal = (data >> 3) & 0x07;

        const color = (background ? this._backgroundPalette[pal].color[index] : this._spritePalette[pal].color[index]);

        let final_value = 0;

        if (hl) {
            const blue = (color.blue & 0x1f) << 2;
            const half_green_hi = (color.green >> 3) & 0x03;

            final_value = (blue | half_green_hi) & 0x7F;
        }
        else {
            const half_green_low = (color.green & 0x07) << 5;
            const red = color.red & 0x1F;

            final_value = (red | half_green_low);
        }

        this._registers[background ? DisplayRegister.BCPD : DisplayRegister.OCPD] = final_value;
    }

    private setColorPaletteData(data: number, background: boolean): void {
        this._gbcMode = true;

        let ps = this._registers[background ? DisplayRegister.BCPS : DisplayRegister.OCPS];
        const increment = (ps & 0x80) ? true : false;
        const hl = (ps & 0x1) != 0;
        const index = (ps >> 1) & 0x03;
        const pal = (ps >> 3) & 0x07;

        if (increment) {
            let address = ps & 0x3F;
            address++;
            address &= 0x3F;
            ps = (ps & 0x80) | address;

            this._registers[background ? DisplayRegister.BCPS : DisplayRegister.OCPS] = ps;
            this.setColorPaletteIndex(ps, background);
        }

        if (hl) {
            const blue = (data >> 2) & 0x1F;
            const halfGreen = (data & 0x03) << 3;

            if (background) {
                this._backgroundPalette[pal].color[index].blue = blue;
                this._backgroundPalette[pal].color[index].green =
                    (this._backgroundPalette[pal].color[index].green & 0x07) | halfGreen;
            } else {
                this._spritePalette[pal].color[index].blue = blue;
                this._spritePalette[pal].color[index].green =
                    (this._spritePalette[pal].color[index].green & 0x07) | halfGreen;
            }
        } else {
            const halfGreen = (data >> 5) & 0x07;
            const red = data & 0x1F;

            if (background) {
                this._backgroundPalette[pal].color[index].red = red;
                this._backgroundPalette[pal].color[index].green =
                    (this._backgroundPalette[pal].color[index].green & 0x18) | halfGreen;
            } else {
                this._spritePalette[pal].color[index].red = red;
                this._spritePalette[pal].color[index].green =
                    (this._spritePalette[pal].color[index].green & 0x18) | halfGreen;
            }
        }
    }

    private _renderScanline(): void {
        this._renderBackground();
        this._renderWindow();
        this._renderSprites();
    }

    private _renderSprites(): void {
        if ((this.LCDC & (1 << 1)) === 0) {
            return;
        }

        const width = 8;
        const height = (this.LCDC & (1 << 2)) ? 16 : 8;
        const tileBase = 0x8000;

        for (let i = 0; i < 40; i++) {
            const addr = 0xFE00 + (i * 4);
            const y = this._cpu.MMU.read8(addr + 0) - 16;
            const x = this._cpu.MMU.read8(addr + 1) - 8;
            let tile = this._cpu.MMU.read8(addr + 2);

            if (height === 16) {
                tile &= ~(0x01);
            }

            const flags = this._cpu.MMU.read8(addr + 3);

            const vramBank = this.gbcMode ? 0 : ((flags & (1 << 3)) ? 1 : 0);
            const flipX = flags & (1 << 5) ? true : false;
            const flipY = flags & (1 << 6) ? true : false;

            const colorPalette = flags & 0x07;
            const palette = flags & (1 << 4) ? this._registers[DisplayRegister.OBP1] : this._registers[DisplayRegister.OBP0];

            if (this.LY < y || this.LY >= y + height) {
                continue;
            }

            let spriteY = this.LY - y;

            if (flipY) {
                spriteY = height - spriteY - 1;
            }

            for (let spriteX = 0; spriteX < width; spriteX++) {
                const pixelX = x + spriteX;
                const tileAddr = tileBase + tile * 16 + (spriteY * 2);

                if (pixelX < 0 || pixelX >= 160) {
                    continue;
                }
                
                const byte1 = this._cpu.MMU.readVideoRam(tileAddr, vramBank);
                const byte2 = this._cpu.MMU.readVideoRam(tileAddr + 1, vramBank);

                let bit = 7 - spriteX;

                if (flipX) {
                    bit = 7 - (7 - spriteX);
                }

                const colorNum = (this._bitGet(byte2, bit) << 1) | (this._bitGet(byte1, bit));

                let color: Color = null;
                if (!this.gbcMode) {
                    color = this._getColor(palette, colorNum, true);
                } else {
                    color = this._getColorGBC(colorPalette, colorNum, false);
                }    

                if (color === null) {
                    continue;
                }

                const index = ((this.LY * 160) + pixelX) * 4;

                if ((flags & (1 << 7)) !== 0 || (this.gbcMode && this._priorityBuffer[(this.LY * 160) + pixelX])) {
                    if (this._framebuffer[index + 0] !== GameboyColorPalette[0]) {
                        continue;
                    }
                }

                this._framebuffer[index + 0] = color.red;
                this._framebuffer[index + 1] = color.green;
                this._framebuffer[index + 2] = color.blue;
                this._framebuffer[index + 3] = 255;
            }
        }
    }

    private _renderWindow(): void {
        if ((this.LCDC & (1 << 5)) === 0) {
            return;
        }

        const base = this._windowTilemap ? 0x9C00 : 0x9800;
        const tileBase = this._activeTileset ? 0x8000 : 0x9000;

        const wx = this.WX - 7;
        const wy = this.WY;

        if (wx > 159) {
            return;
        }

        if ((wy > 143) || (wy > this.LY)) {
            return;
        }
        
        const winY = this.LY - wy;
        const tileY = Math.floor(winY / 8) % 32;
        const tileYOffset = winY % 8;

        let tx = -1;
        let byte1 = 0;
        let byte2 = 0;
        let tileFlipX = false;
        let tileFlipY = false;
        let tilePriority = false;
        let tileBank = 0;
        let tilePalette = 0;

        for (let x = 0; x < 160; x++) {
            if ((wx + x) < 0 || (wx + x) >= 160) {
                continue;
            }

            const tileX = Math.floor(x / 8) % 32;

            if (tx !== tileX) {
                let tileMapAddr = base + (tileY * 32) + tileX;
                let tileNumber = this._cpu.MMU.readVideoRam(tileMapAddr, 0);

                if (this.gbcMode) {
                    const tileAttribute = this._cpu.MMU.readVideoRam(tileMapAddr, 1);
                    tilePalette = tileAttribute & 0x07;
                    tileBank = (tileAttribute >> 3) & 0x01;
                    tileFlipX = ((tileAttribute >> 5) & 0x01) === 1;
                    tileFlipY = ((tileAttribute >> 6) & 0x01) === 1;
                    tilePriority = ((tileAttribute >> 7) & 0x01) === 1;
                }

                // Read tileValue as signed
                if (!this._activeTileset) {
                    let msb_mask = 1 << (8 - 1);
                    tileNumber = (tileNumber ^ msb_mask) - msb_mask;
                }

                const tileAddr = tileBase + tileNumber * 0x10 + (tileYOffset * 2);

                byte1 = this._cpu.MMU.readVideoRam(tileAddr, tileBank);
                byte2 = this._cpu.MMU.readVideoRam(tileAddr + 1, tileBank);

                tx = tileX;
            }

            const bit = 7 - (x % 8);

            const colorNum = (this._bitGet(byte2, bit) << 1) | (this._bitGet(byte1, bit));
            const index = ((this.LY * 160) + wx + x) * 4;

            let color: Color = null;
            if (!this.gbcMode) {
                color = this._getColor(this.BGP, colorNum, false);
            } else {
                this._priorityBuffer[(this.LY * 160) + wx + x] = tilePriority;
                color = this._getColorGBC(tilePalette, colorNum, true);
            }

            this._framebuffer[index + 0] = color.red;
            this._framebuffer[index + 1] = color.green;
            this._framebuffer[index + 2] = color.blue;
            this._framebuffer[index + 3] = 255;
        }
    }

    private _renderBackground(): void {
        if ((this.LCDC & (1 << 0)) === 0 && !this.gbcMode) {
            return;
        }

        const base = this._backgroundTilemap ? 0x9C00 : 0x9800;
        const tileBase = this._activeTileset ? 0x8000 : 0x9000;

        const tileY = Math.floor((this.LY + this.SCY) / 8) % 32;
        const tileYOffset = (this.LY + this.SCY) % 8;

        let tx = -1;
        let byte1 = 0;
        let byte2 = 0;
        let tileFlipX = false;
        let tileFlipY = false;
        let tilePriority = false;
        let tileBank = 0;
        let tilePalette = 0;

        for (let x = 0; x < 160; x++) {
            const tileX = Math.floor((this.SCX + x) / 8) % 32;

            if (tx !== tileX) {
                let tileMapAddr = base + (tileY * 32) + tileX;
                let tileNumber = this._cpu.MMU.readVideoRam(tileMapAddr, 0);

                if (this.gbcMode) {
                    const tileAttribute = this._cpu.MMU.readVideoRam(tileMapAddr, 1);
                    tilePalette = tileAttribute & 0x07;
                    tileBank = (tileAttribute & (1 << 3)) ? 1 : 0;
                    tileFlipX = ((tileAttribute >> 5) & 0x01) === 1;
                    tileFlipY = ((tileAttribute >> 6) & 0x01) === 1;
                    tilePriority = ((tileAttribute >> 7) & 0x01) === 1;
                }

                // Read tileValue as signed
                if (!this._activeTileset) {
                    let msb_mask = 1 << (8 - 1);
                    tileNumber = (tileNumber ^ msb_mask) - msb_mask;
                }

                const tileAddr = tileBase + tileNumber * 0x10 + (tileYOffset * 2);

                byte1 = this._cpu.MMU.readVideoRam(tileAddr, tileBank);
                byte2 = this._cpu.MMU.readVideoRam(tileAddr + 1, tileBank);

                tx = tileX;
            }

            const bit = 7 - ((this.SCX + x) % 8);
            const colorNum = (this._bitGet(byte2, bit) << 1) | (this._bitGet(byte1, bit));
            const index = ((this.LY * 160) + x) * 4;

            let color: Color = null;
            if (!this.gbcMode) {
                color = this._getColor(this.BGP, colorNum, false);
            } else {
                this._priorityBuffer[(this.LY * 160) + x] = tilePriority;
                color = this._getColorGBC(tilePalette, colorNum, true);
            }

            this._framebuffer[index + 0] = color.red;
            this._framebuffer[index + 1] = color.green;
            this._framebuffer[index + 2] = color.blue;
            this._framebuffer[index + 3] = 255;
        }
    }

    private _bitGet(input: number, bit: number): number {
        return input & (1 << bit) ? 1 : 0;
    }

    private _getColor(palette: number, bit: number, transparent: boolean): Color | null {
        const hi = ((bit << 1) + 1);
        const lo = (bit << 1);
        const color = (this._bitGet(palette, hi) << 1) | (this._bitGet(palette, lo));

        if (bit === 0 && transparent) {
            return null;
        }

        return {
            red: GameboyColorPalette[color],
            green: GameboyColorPalette[color],
            blue: GameboyColorPalette[color]
        };
    }

    private _getColorGBC(palette: number, bit: number, background: boolean): Color | null {
        if (bit === 0 && !background) {
            return null;
        }

        if (background) {
            return {
                red: Math.round((this._backgroundPalette[palette].color[bit].red / 0x1F) * GameboyColorPalette[0]),
                green: Math.round((this._backgroundPalette[palette].color[bit].green / 0x1F) * GameboyColorPalette[0]),
                blue: Math.round((this._backgroundPalette[palette].color[bit].blue / 0x1F) * GameboyColorPalette[0])
            };
        }

        return {
            red: Math.round((this._spritePalette[palette].color[bit].red / 0x1F) * GameboyColorPalette[0]),
            green: Math.round((this._spritePalette[palette].color[bit].green / 0x1F) * GameboyColorPalette[0]),
            blue: Math.round((this._spritePalette[palette].color[bit].blue / 0x1F) * GameboyColorPalette[0])
        };
    }

    private _render(): void {
        this._context.putImageData(this._data, 0, 0);
    }

    private _readRegister(register: DisplayRegister): number {
        return this._registers[register];
    }

    private _writeRegister(register: DisplayRegister, value: number): void {
        switch (register) {
            case DisplayRegister.DMA:
                this._cpu.MMU.performOAMDMATransfer(value * 0x100);
                break;
            
            case DisplayRegister.LCDC:
                if (!(value & (1 << 7))) {
                    for (let x = 0; x < 160; x++) {
                        for (let y = 0; y < 144; y++) {
                            const index = ((y * 160) + x) * 4;

                            this._framebuffer[index + 0] = GameboyColorPalette[0];
                            this._framebuffer[index + 1] = GameboyColorPalette[0];
                            this._framebuffer[index + 2] = GameboyColorPalette[0];
                            this._framebuffer[index + 3] = 0xFF;
                        }
                    }

                    this._render();
                }    
                break;
            
            case DisplayRegister.BCPS:
                this.setColorPaletteIndex(value, true);
                break;

            case DisplayRegister.BCPD:
                this.setColorPaletteData(value, true);
                break;

            case DisplayRegister.OCPS:
                this.setColorPaletteIndex(value, false);
                break;

            case DisplayRegister.OCPD:
                this.setColorPaletteData(value, false);
                break;
        }

        this._registers[register] = value;
    }

    public get LY() {
        return this._registers[DisplayRegister.LY];
    }

    public set LY(val: number) {
        this._registers[DisplayRegister.LY] = val;
    }

    public get LYC() {
        return this._registers[DisplayRegister.LYC];
    }

    public set LYC(val: number) {
        this._registers[DisplayRegister.LYC] = val;
    }

    public get WX() {
        return this._registers[DisplayRegister.WX];
    }

    public set WX(val: number) {
        this._registers[DisplayRegister.WX] = val;
    }

    public get WY() {
        return this._registers[DisplayRegister.WY];
    }

    public set WY(val: number) {
        this._registers[DisplayRegister.WY] = val;
    }

    public get SCX() {
        return this._registers[DisplayRegister.SCX];
    }

    public set SCX(val: number) {
        this._registers[DisplayRegister.SCX] = val;
    }

    public get SCY() {
        return this._registers[DisplayRegister.SCY];
    }

    public set SCY(val: number) {
        this._registers[DisplayRegister.SCY] = val;
    }

    public get BGP() {
        return this._registers[DisplayRegister.BGP];
    }

    public set BGP(val: number) {
        this._registers[DisplayRegister.BGP] = val;
    }

    public get LCDC() {
        return this._registers[DisplayRegister.LCDC];
    }

    public set LCDC(val: number) {
        this._registers[DisplayRegister.LCDC] = val;
    }

    public get STAT() {
        return this._registers[DisplayRegister.STAT];
    }

    public set STAT(val: number) {
        this._registers[DisplayRegister.STAT] = val;
    }

    public get mode() {
        return this._registers[DisplayRegister.STAT] & 0x03;
    }

    public set mode(val: number) {
        this._registers[DisplayRegister.STAT] = ((this._registers[DisplayRegister.STAT] & ~0x03) | val);
    }

    public get gbcMode(): boolean {
        return this._cpu._inBootstrap ? this._gbcMode : this._cpu.gbcMode;
    }
}
