import { CPU, RomType } from './cpu';
import { RomOnlyMemoryController } from './romonly';
import { MBC1 } from './mbc1';
import { MBC3 } from './mbc3';

interface IRegister
{
    read: () => number;
    write: (value: number) => void;
}

export interface MemoryController
{
    read(position: number): number;
    write(position: number, value: number): void;
}

export class Memory
{
    private _cpu: CPU;
    private _registers: { [key: number]: IRegister };
    private _controller: MemoryController;

    private _bios: number[];
    public _rom: number[];
    private _biosEnabled: boolean;

    private _vram: number[][];
    private _hram: number[];
    private _wram: number[];
    private _oamram: number[];
    private _ram: number[];
    private _type: RomType;
    private _wramBank: number;
    private _vramBank: number;

    constructor(cpu: CPU)
    {
        this._cpu = cpu;
        this._registers = {};
        this._bios = null;
        this._rom = null;
        this._biosEnabled = true;
        this._wram = Array(0x8000).fill(0xFF);
        this._vram = [Array(0x2000).fill(0xFF), Array(0x2000).fill(0xFF)];
        this._hram = Array(127).fill(0xFF);
        this._oamram = Array(0xA0).fill(0xFF);
        this._ram = Array(0x8000).fill(0xFF);
        this._wramBank = 1;
        this._vramBank = 0;

        this.addRegister(0xFF50, () => 0, (x) => {
            this._biosEnabled = false;
            this._cpu._inBootstrap = false;
        });

        this.addRegister(0xFF70, () => 0x40 | this._wramBank & 0x07, (x) => {
            this._wramBank = x & 0x07;
        });

        this.addRegister(0xFF4F, () => this._vramBank & 0x01, (x) => {
            this._vramBank = x & 0x01;
        });

        const tmp = new Uint8Array(9);
        tmp[0] = 0xFE;
        tmp[1] = 0x00;
        tmp[2] = 0x00;
        tmp[3] = 0x00;
        tmp[4] = 0x8F;
        tmp[5] = 0x00;
        tmp[6] = 0x00;
        tmp[7] = 0x00;
        tmp[8] = 0x02;

        // KEY1
        // this.addRegister(0xFF4D, () => tmp[7], (x) => { tmp[7] = x; });

        // Infrared Communications Port
        // this.addRegister(0xFF56, () => 0x3C | tmp[8], (x) => { tmp[8] = x; });

        // Undocumented registers
        // this.addRegister(0xFF72, () => tmp[1], (x) => { console.log(`0xFF72: ${x.toString(16)}`); tmp[1] = x; });
        // this.addRegister(0xFF73, () => tmp[2], (x) => { console.log(`0xFF73: ${x.toString(16)}`); tmp[2] = x; });
        // this.addRegister(0xFF74, () => tmp[3], (x) => { console.log(`0xFF74: ${x.toString(16)}`); tmp[3] = x; });
        // this.addRegister(0xFF75, () => 0x8F | tmp[4], (x) => { console.log(`0xFF75: ${x.toString(16)}`); tmp[4] = x; });
        // this.addRegister(0xFF76, () => tmp[5], (x) => { console.log(`0xFF76: ${x.toString(16)}`); tmp[5] = x; });
        // this.addRegister(0xFF77, () => tmp[6], (x) => { console.log(`0xFF77: ${x.toString(16)}`); tmp[6] = x; });
    }

    public createController(romType: RomType): void
    {
        this._type = romType;

        switch (romType) {
            case RomType.MBC1:
            case RomType.MBC1RAM:
            case RomType.MBC1RAMBATTERY:
                this._controller = new MBC1(this);
                break;
            
            case RomType.MBC3:
            case RomType.MBC3RAM:
            case RomType.MBC3RAMBATTERY:
            case RomType.MBC3TIMERBATTERY:
            case RomType.MBC3TIMERRAMBATTERY:
                console.log(`ROMTYPE = ${romType}`);
                this._controller = new MBC3(this);
                break;
            
            case RomType.UNKNOWN:
            case RomType.ROMONLY:
                this._controller = new RomOnlyMemoryController(this);
                break;
            
            default:
                console.log("UNKNOWN ROM TYPE: " + romType.toString(16));
                this._controller = new RomOnlyMemoryController(this);
                break;
        }
    }

    public addRegister(position: number, read: () => number, write: (value: number) => void): void
    {
        this._registers[position] = {
            read,
            write
        };
    }

    public setBios(buffer: Buffer): boolean
    {
        if (buffer === null) {
            return false;
        }

        this._bios = [...buffer];
        return true;
    }

    public setRom(buffer: Buffer): boolean
    {
        if (buffer === null) {
            return false;
        }

        this._rom = [...buffer];
        return true;
    }

    public readVideoRam(position: number, bank: number): number {
        if (!this._biosEnabled && !this._cpu.gbcMode) {
            return this._vram[0][position - 0x8000];
        }

        return this._vram[bank][position - 0x8000];
    }

    public readWorkRam(position: number, bank: number): number {
        if (!this._biosEnabled && !this._cpu.gbcMode) {
            return this._wram[position - 0xC000];
        }

        return this._wram[(position - 0xC000) + ((bank - 1) * 0x1000)];
    }

    public writeVideoRam(position: number, bank: number, data: number): void {
        if (!this._biosEnabled && !this._cpu.gbcMode) {
            this._vram[0][position - 0x8000] = data & 0xFF;
            return;
        }

        this._vram[bank][position - 0x8000] = data & 0xFF;
    }

    public writeWorkRam(position: number, bank: number, data: number): void {
        if (!this._biosEnabled && !this._cpu.gbcMode) {
            this._wram[position - 0xC000] = data & 0xFF;
            return;
        }

        if (position < 0xD000) {
            this._wram[position - 0xC000] = data & 0xFF;
        } else {
            this._wram[(position - 0xC000) + ((bank - 1) * 0x1000)] = data & 0xFF;
        }
    }

    public read8(position: number): number
    {
        if (position < this._bios.length && this._biosEnabled) {
            if (position < 0x100 || position >= 0x200) {
                return this._bios[position];
            }
        }
        
        if (this._registers[position] !== undefined) {
            return this._registers[position].read();
        }

        switch (position & 0xF000) {
            case 0x8000:
            case 0x9000:
                return this.readVideoRam(position, this._vramBank);
            
            case 0xC000:
                return this.readWorkRam(position, 1);
            
            case 0xD000:
                return this.readWorkRam(position, this._wramBank);
            
            case 0xF000:
                if (position >= 0xFF80 && position <= 0xFFFE) {
                    return this._hram[position - 0xFF80];
                } else if (position >= 0xFE00 && position <= 0xFE9F) {
                    return this._oamram[position - 0xFE00];
                }
            
            default:
                return this._controller.read(position);
        }
    }

    public write8(position: number, data: number): void
    {
        if (position < this._bios.length && this._biosEnabled) {
            if (position < 0x100 || position >= 0x200) {
                this._bios[position] = data & 0xFF;
                return;
            }
        }

        if (this._registers[position] !== undefined) {
            this._registers[position].write(data);
            return;
        }

        switch (position & 0xF000) {
            case 0x8000:
            case 0x9000:
                this.writeVideoRam(position, this._vramBank, data);
                break;

            case 0xC000:
            case 0xD000:
                this.writeWorkRam(position, this._wramBank, data);
                break;

            case 0xF000:
                if (position >= 0xFF80 && position <= 0xFFFE) {
                    this._hram[position - 0xFF80] = data & 0xFF;
                    break;
                } else if (position >= 0xFE00 && position <= 0xFE9F) {
                    this._oamram[position - 0xFE00] = data & 0xFF;
                    break;
                }

            default:
                this._controller.write(position, data & 0xFF);
        }
    }

    public readInternal8(position: number): number
    {
        if (position < this._bios.length && this._biosEnabled) {
            if (position < 0x100 || position >= 0x200) {
                return this._bios[position];
            }
        }

        return this._rom[position];
    }

    public writeInternal8(position: number, data: number): void
    {
        if (position < this._bios.length && this._biosEnabled) {
            if (position < 0x100 || position >= 0x200) {
                this._bios[position] = data & 0xFF;
                return;
            }
        }

        this._rom[position] = data & 0xFF;
    }

    public readRam8(position: number): number
    {
        return this._ram[position];
    }

    public writeRam8(position: number, data: number): void
    {
        this._ram[position] = data & 0xFF;
    }

    public performOAMDMATransfer(position: number): void
    {
        for (let i = 0; i <= 0x9F; i++) {
            this._oamram[i] = this.read8(position + i);
        }
    }

    public tick(cycles: number): void
    {
    }

    public saveRam(): void
    {
        let identifier = this._cpu.romName.trim() + this._cpu.romHeaderChecksum + this._cpu.romGlobalChecksum;
        identifier = identifier.replace(/\s/g, "");

        localStorage.setItem(identifier, JSON.stringify(this._ram));
    }

    public loadRam(): void
    {
        let identifier = this._cpu.romName.trim() + this._cpu.romHeaderChecksum + this._cpu.romGlobalChecksum;
        identifier = identifier.replace(/\s/g, "");

        const data = localStorage.getItem(identifier);

        if (!data) {
            return;
        }

        this._ram = JSON.parse(data);
    }
}
