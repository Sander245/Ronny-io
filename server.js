const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    allowEIO3: true
});
const fs = require('fs');

// Add CORS middleware for Express routes
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

app.use(express.static('.'));
app.use(express.json()); // Parse JSON bodies

// Health check endpoint for tunnel validation
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

// Save tank endpoint
app.post('/saveTank', (req, res) => {
    try {
        const { tankConfig, upgradePaths } = req.body;
        
        if (!tankConfig || !tankConfig.name) {
            return res.status(400).json({ success: false, error: 'Invalid tank configuration' });
        }

        const tankName = tankConfig.name.toUpperCase();
        
        // Read current tankUpgrades.json
        const upgradesData = fs.readFileSync('./tankUpgrades.json', 'utf8');
        const allTanks = JSON.parse(upgradesData);
        
        // Add new tank to TANK_TYPES
        allTanks[tankName] = {
            name: tankConfig.name,
            level: tankConfig.level || 1,
            guns: tankConfig.guns || [],
            hideFromTree: tankConfig.hideFromTree || false,
            upgrades: [] // Will be populated later
        };
        
        // Update upgrade paths for parent tanks
        upgradePaths.forEach(parentName => {
            const parent = parentName.toUpperCase();
            if (allTanks[parent]) {
                if (!allTanks[parent].upgrades) {
                    allTanks[parent].upgrades = [];
                }
                if (!allTanks[parent].upgrades.includes(tankName)) {
                    allTanks[parent].upgrades.push(tankName);
                }
            }
        });
        
        // Write back to file
        fs.writeFileSync('./tankUpgrades.json', JSON.stringify(allTanks, null, 2));
        
        // Update runtime data
        TANK_TYPES = allTanks;
        Object.keys(TANK_TYPES).forEach(key => {
            TANK_UPGRADES[key] = TANK_TYPES[key].upgrades || [];
        });
        
        console.log(`Tank ${tankName} saved successfully`);
        res.json({ success: true });
        
    } catch (err) {
        console.error('Error saving tank:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Root endpoint
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Load tank upgrades from JSON file
let TANK_TYPES = {};
let TANK_UPGRADES = {};
try {
    const upgradesData = fs.readFileSync('./tankUpgrades.json', 'utf8');
    TANK_TYPES = JSON.parse(upgradesData);
    console.log('Loaded', Object.keys(TANK_TYPES).length, 'tank configurations from tankUpgrades.json');
    
    // Extract upgrade paths for use in server
    Object.keys(TANK_TYPES).forEach(key => {
        TANK_UPGRADES[key] = TANK_TYPES[key].upgrades || [];
    });
} catch (err) {
    console.error('Error loading tank upgrades:', err);
}

const GAME_CONFIG = {
    MAP_RADIUS: 3000,
    TICK_RATE: 60,
    MAX_POLYGONS: 150,
    POLYGON_SPAWN_RATE: 0.3,
    GRID_SIZE: 50
};

class GameObject {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.id = Math.random().toString(36).substr(2, 9);
    }
}

class Polygon extends GameObject {
    constructor(x, y, sides) {
        super(x, y);
        this.sides = sides;
        this.size = this.getSizeFromSides(sides);
        
        // Health calculation with tier bonuses
        let healthMultiplier = 20 * 3; // Base multiplier (tripled)
        if (sides >= 14) healthMultiplier = 20 * 8; // Tier 5: 8x health
        else if (sides >= 12) healthMultiplier = 20 * 5; // Tier 4: 5x health
        else if (sides === 3) healthMultiplier = 10; // Triangles: low health
        
        this.health = this.size * healthMultiplier;
        this.maxHealth = this.health;
        
        // XP calculation with tier bonuses
        let xpMultiplier = 5;
        if (sides >= 14) xpMultiplier = 50; // Tier 5: 10x XP
        else if (sides >= 12) xpMultiplier = 25; // Tier 4: 5x XP
        
        this.xp = Math.floor(this.size * xpMultiplier * sides);
        this.color = this.getColorFromSides(sides);
        this.type = this.getTypeFromSides(sides);
        this.rotationSpeed = 0.02 * (1 / Math.sqrt(sides)); // Smoother rotation
        this.rotation = 0;
        // Random initial floating velocity - extremely slow
        const floatSpeed = 0.01; // Reduced from 0.05 to 0.01
        const angle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(angle) * floatSpeed * Math.random();
        this.vy = Math.sin(angle) * floatSpeed * Math.random();
        this.floatAngle = Math.random() * Math.PI * 2;
        // Death animation
        this.dying = false;
        this.deathStartTime = 0;
        this.deathDuration = 200; // 0.2 seconds in milliseconds
        this.baseSize = this.size;
    }

    getSizeFromSides(sides) {
        const sizes = {3: 12, 4: 18, 5: 25, 6: 35, 8: 75, 10: 100, 12: 130, 13: 150, 14: 200, 15: 250, 16: 300};
        return sizes[sides] || 20;
    }

    getColorFromSides(sides) {
        const colors = {
            3: '#FE7C6D',  // Triangle - orange
            4: '#FFD66B',  // Square - yellow
            5: '#768EFC',  // Pentagon - blue
            6: '#C77EF6',  // Hexagon - purple
            8: '#FF6EC7',  // Octagon - pink
            10: '#00E0C6', // Decagon - cyan (boss)
            12: '#FF9500', // Dodecagon - orange (mega boss)
            13: '#FF1744', // Tridecagon - red
            14: '#9C27B0', // Tetradecagon - deep purple
            15: '#424242', // Pentadecagon - dark grey
            16: '#000000'  // Hexadecagon - black (ultra rare)
        };
        return colors[sides] || '#FFD66B';
    }
    
    getTypeFromSides(sides) {
        const types = {
            3: 'Triangle',
            4: 'Square',
            5: 'Pentagon',
            6: 'Hexagon',
            8: 'Octagon',
            10: 'Decagon',
            12: 'Dodecagon',
            13: 'Tridecagon',
            14: 'Tetradecagon',
            15: 'Pentadecagon',
            16: 'Hexadecagon'
        };
        return types[sides] || 'Polygon';
    }

    update() {
        this.rotation += this.rotationSpeed;
        
        // Only move if not dying
        if (!this.dying) {
            // Floating movement (gentle drift) - extremely slow
            this.floatAngle += 0.002; // Even slower angle change
            const floatForce = 0.003; // Reduced from 0.01 to 0.003
            this.vx += Math.cos(this.floatAngle) * floatForce;
            this.vy += Math.sin(this.floatAngle) * floatForce;
            
            // Apply velocity
            this.x += this.vx;
            this.y += this.vy;
            
            // Slow down velocity over time (slight friction)
            this.vx *= 0.98;
            this.vy *= 0.98;
            
            // Keep within bounds
            const maxDist = GAME_CONFIG.MAP_RADIUS - this.size;
            const dist = Math.sqrt(this.x * this.x + this.y * this.y);
            if (dist > maxDist) {
                const angle = Math.atan2(this.y, this.x);
                this.x = Math.cos(angle) * maxDist;
                this.y = Math.sin(angle) * maxDist;
                // Bounce off walls
                this.vx *= -0.5;
                this.vy *= -0.5;
            }
        }
    }

    startDeath() {
        this.dying = true;
        this.deathStartTime = Date.now();
    }

    getDeathProgress() {
        if (!this.dying) return 0;
        const elapsed = Date.now() - this.deathStartTime;
        return Math.min(elapsed / this.deathDuration, 1);
    }

    isDeathComplete() {
        return this.dying && this.getDeathProgress() >= 1;
    }

    takeDamage(damage) {
        if (this.dying) return false; // Can't damage dying polygons
        this.health -= damage;
        if (this.health <= 0) {
            this.startDeath();
            return true;
        }
        return false;
    }
}

class Bullet extends GameObject {
    constructor(x, y, angle, owner, damage, speed, size = 8, health = 5) {
        super(x, y);
        this.angle = angle;
        this.owner = owner;
        this.damage = damage;
        this.speed = speed;
        this.size = size;
        this.health = health;
        this.maxHealth = health;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.lifespan = 0;
        this.maxLifespan = 200;
        this.dying = false;
        this.deathStartTime = 0;
        this.deathDuration = 200; // Faster death animation for bullets (200ms)
    }

    update() {
        // Only move if not dying
        if (!this.dying) {
            this.x += this.vx;
            this.y += this.vy;
            this.lifespan++;
        }
    }

    startDeath() {
        this.dying = true;
        this.deathStartTime = Date.now();
        this.vx = 0;
        this.vy = 0;
    }

    getDeathProgress() {
        if (!this.dying) return 0;
        const elapsed = Date.now() - this.deathStartTime;
        return Math.min(elapsed / this.deathDuration, 1);
    }

    isDeathComplete() {
        return this.dying && this.getDeathProgress() >= 1;
    }

    isExpired() {
        return this.lifespan > this.maxLifespan || (this.health <= 0 && !this.dying);
    }
}

class Trap extends GameObject {
    constructor(x, y, angle, owner, damage, size = 15, shootDistance = 8, friction = 0.92) {
        super(x, y);
        this.angle = angle;
        this.owner = owner;
        this.damage = damage;
        this.size = size;
        this.health = 50;
        this.maxHealth = 50;
        this.sides = 3;
        this.rotation = 0;
        this.rotationSpeed = 0.05;
        
        // Initial movement - configurable shoot distance
        this.vx = Math.cos(angle) * shootDistance;
        this.vy = Math.sin(angle) * shootDistance;
        this.friction = friction; // Configurable friction
        
        // Death animation
        this.dying = false;
        this.deathStartTime = 0;
        this.deathDuration = 200; // 0.2 seconds
    }

    update() {
        // Only move if not dying
        if (!this.dying) {
            this.x += this.vx;
            this.y += this.vy;
            this.vx *= this.friction;
            this.vy *= this.friction;
            this.rotation += this.rotationSpeed;
        }
    }
    
    startDeath() {
        this.dying = true;
        this.deathStartTime = Date.now();
        this.vx = 0;
        this.vy = 0;
    }

    getDeathProgress() {
        if (!this.dying) return 0;
        const elapsed = Date.now() - this.deathStartTime;
        return Math.min(elapsed / this.deathDuration, 1);
    }

    isDeathComplete() {
        return this.dying && this.getDeathProgress() >= 1;
    }
    
    takeDamage(amount) {
        if (this.dying) return false;
        this.health -= amount;
        if (this.health <= 0) {
            this.startDeath();
            return true;
        }
        return false;
    }
}

class Minion extends GameObject {
    constructor(x, y, owner, damage, speed, size = 12, health = 30, penetration = 1) {
        super(x, y);
        this.owner = owner;
        this.damage = damage;
        this.maxSpeed = speed * 1.8; // Scale well with bullet speed upgrades
        this.acceleration = 0.25; // Faster acceleration
        this.deceleration = 0.94; // Less drag (keeps more momentum)
        this.size = size;
        this.health = health;
        this.maxHealth = health;
        this.penetration = penetration;
        this.targetX = x;
        this.targetY = y;
        this.rotation = 0;
        this.vx = 0; // Velocity X
        this.vy = 0; // Velocity Y
        // Death animation
        this.dying = false;
        this.deathStartTime = 0;
        this.deathDuration = 200; // 0.2 seconds
    }

    update(targetX, targetY, ownerX, ownerY, shooting) {
        // If shooting, follow mouse; otherwise, return to owner
        if (shooting) {
            this.targetX = targetX;
            this.targetY = targetY;
        } else {
            this.targetX = ownerX;
            this.targetY = ownerY;
        }

        const dx = this.targetX - this.x;
        const dy = this.targetY - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 10) {
            // Accelerate towards target
            const dirX = dx / dist;
            const dirY = dy / dist;
            
            this.vx += dirX * this.acceleration;
            this.vy += dirY * this.acceleration;
            
            // Cap speed at maxSpeed
            const currentSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
            if (currentSpeed > this.maxSpeed) {
                this.vx = (this.vx / currentSpeed) * this.maxSpeed;
                this.vy = (this.vy / currentSpeed) * this.maxSpeed;
            }
        } else {
            // Close to target, apply stronger deceleration
            this.vx *= 0.8;
            this.vy *= 0.8;
        }
        
        // Apply deceleration (drag)
        this.vx *= this.deceleration;
        this.vy *= this.deceleration;
        
        // Update position
        this.x += this.vx;
        this.y += this.vy;

        // Smooth rotation interpolation
        const targetRotation = Math.atan2(dy, dx);
        let angleDiff = targetRotation - this.rotation;
        
        // Normalize angle difference to [-PI, PI]
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        
        this.rotation += angleDiff * 0.15;
    }

    startDeath() {
        this.dying = true;
        this.deathStartTime = Date.now();
        this.vx = 0;
        this.vy = 0;
    }

    getDeathProgress() {
        if (!this.dying) return 0;
        const elapsed = Date.now() - this.deathStartTime;
        return Math.min(elapsed / this.deathDuration, 1);
    }

    isDeathComplete() {
        return this.dying && this.getDeathProgress() >= 1;
    }
}

class Player extends GameObject {
    constructor(x, y, name) {
        super(x, y);
        this.name = name || 'Tank';
        this.tankType = 'BASIC';
        this.level = 0; // Start at level 0
        this.xp = 0;
        this.maxHealth = 50; // Weaker starting health
        this.health = 50;
        this.size = 20;
        this.rotation = 0;
        this.invincible = false; // Invincibility cheat flag
        this.stats = {
            healthRegen: 0,
            maxHealth: 0,
            bodyDamage: 0,
            bulletSpeed: 0,
            bulletPenetration: 0,
            bulletDamage: 0,
            reload: 0,
            movementSpeed: 0
        };
        this.mouseX = 0;
        this.mouseY = 0;
        this.moving = {up: false, down: false, left: false, right: false};
        this.shooting = false;
        this.lastShot = 0;
        this.currentCycleStart = 0; // Track when current reload cycle started
        this.gunCooldowns = {}; // Track individual gun cooldowns for delays
        this.gunRecoils = {}; // Track gun recoil animations
        this.regenCooldown = 0;
        this.score = 0;
        // Velocity for smooth movement
        this.vx = 0;
        this.vy = 0;
        // Upgrade points system
        this.upgradePoints = 0;
        // Damage tracking for death screen
        this.damageHistory = [];
        // AFK detection
        this.lastActivityTime = Date.now();
        // Initialize size based on level
        this.updateSize();
    }

    getStatValue(stat) {
        return this.stats[stat];
    }

    updateSize() {
        // Size scales with level: exponential growth (slower at higher levels)
        // Using logarithmic scaling: base 20 + log growth
        // This makes early levels grow faster (1-30) and high levels (60-80) grow much slower
        this.size = 20 + Math.log(this.level + 1) * 8;
    }

    getMaxHealth() {
        const tankConfig = TANK_TYPES[this.tankType];
        const healthBonus = tankConfig.healthBonus || 1;
        // Level-based health: higher level = more health (10 HP per level)
        const levelBonus = this.level * 10;
        return ((this.maxHealth + (this.stats.maxHealth * 20)) * healthBonus + levelBonus) * 3; // 3x health multiplier
    }

    getRegenRate() {
        return 0.5 + (this.stats.healthRegen * 0.5);
    }

    getBodyDamage() {
        const tankConfig = TANK_TYPES[this.tankType];
        const bonus = tankConfig.bodyDamageBonus || 1;
        return (10 + this.stats.bodyDamage * 2) * bonus * 2; // 2x faster body damage
    }

    getBulletSpeed() {
        return 6 + this.stats.bulletSpeed * 0.6;
    }

    getBulletDamage() {
        return 20 + this.stats.bulletDamage * 5;
    }
    
    // Damage modifier for bullets hitting players (reduced)
    getBulletDamageToPlayers() {
        return this.getBulletDamage() * 0.5; // 50% damage to players
    }

    getBulletHealth() {
        return 10 + this.stats.bulletPenetration * 5;
    }

    getReloadSpeed() {
        return 1 + this.stats.reload * 0.15;
    }

    getMoveSpeed() {
        const tankConfig = TANK_TYPES[this.tankType];
        if (!tankConfig) {
            console.warn(`[PLAYER] Warning: Tank config not found for ${this.tankType}, using default speed`);
            return 3; // Default speed
        }
        const bonus = tankConfig.speedBonus || 1;
        return (3 + this.stats.movementSpeed * 0.3) * bonus;
    }

    update() {
        // Movement with acceleration
        const speed = this.getMoveSpeed();
        const acceleration = 0.15; // Lower acceleration for smoother movement
        const friction = 0.97; // Even less friction for more sliding
        
        let targetVx = 0, targetVy = 0;
        if (this.moving.up) targetVy -= speed;
        if (this.moving.down) targetVy += speed;
        if (this.moving.left) targetVx -= speed;
        if (this.moving.right) targetVx += speed;

        // Normalize diagonal movement
        if (targetVx !== 0 && targetVy !== 0) {
            const len = Math.sqrt(targetVx * targetVx + targetVy * targetVy);
            targetVx = (targetVx / len) * speed;
            targetVy = (targetVy / len) * speed;
        }

        // Apply acceleration
        this.vx += (targetVx - this.vx) * acceleration;
        this.vy += (targetVy - this.vy) * acceleration;
        
        // Apply friction when not moving
        if (targetVx === 0 && targetVy === 0) {
            this.vx *= friction;
            this.vy *= friction;
        }
        
        // Apply velocity
        this.x += this.vx;
        this.y += this.vy;

        // Keep in bounds
        const maxDist = GAME_CONFIG.MAP_RADIUS - this.size;
        const dist = Math.sqrt(this.x * this.x + this.y * this.y);
        if (dist > maxDist) {
            const angle = Math.atan2(this.y, this.x);
            this.x = Math.cos(angle) * maxDist;
            this.y = Math.sin(angle) * maxDist;
            // Stop velocity when hitting boundary
            this.vx = 0;
            this.vy = 0;
        }

        // Rotation
        const dx = this.mouseX - this.x;
        const dy = this.mouseY - this.y;
        this.rotation = Math.atan2(dy, dx);

        // Health regen
        if (this.regenCooldown > 0) {
            this.regenCooldown--;
        } else {
            const maxHP = this.getMaxHealth();
            if (this.health < maxHP) {
                this.health = Math.min(maxHP, this.health + this.getRegenRate());
            }
        }
        
        // Update gun recoil animations (decay back to 0)
        for (const gunKey in this.gunRecoils) {
            if (this.gunRecoils[gunKey] > 0) {
                this.gunRecoils[gunKey] = Math.max(0, this.gunRecoils[gunKey] - 2); // Decay by 2 pixels per tick
            }
        }

        // Clean old damage history (older than 7 seconds)
        const now = Date.now();
        this.damageHistory = this.damageHistory.filter(d => now - d.time < 7000);
    }

    takeDamage(damage, source = null) {
        // Ignore damage if invincible
        if (this.invincible) {
            return false;
        }
        
        this.health -= damage;
        this.regenCooldown = 60;
        
        // Track damage source
        if (source) {
            this.damageHistory.push({
                source: source,
                time: Date.now()
            });
        }
        
        return this.health <= 0;
    }

    addXP(amount) {
        const oldLevel = this.level;
        this.xp += amount;
        this.score += amount;
        
        // Check for multiple level ups with while loop
        while (this.xp >= this.level * 100) {
            const requiredXP = this.level * 100;
            this.xp -= requiredXP;
            this.level++;
            this.updateSize(); // Update size when leveling up
            
            // Award upgrade points based on level
            if (this.level <= 5) {
                this.upgradePoints += 1;
            } else {
                // After level 5, award 1 point every 2 levels
                if ((this.level - 5) % 2 === 1) {
                    this.upgradePoints += 1;
                }
            }
            
            // Heal on level up
            this.health = Math.min(this.getMaxHealth(), this.health);
        }
    }

    upgradeStat(stat) {
        // Cap at 7 levels, need upgrade points
        if (this.upgradePoints > 0 && this.stats[stat] < 7) {
            this.stats[stat]++;
            this.upgradePoints--;
            return true;
        }
        return false;
    }

    upgradeTank(newType) {
        console.log(`[PLAYER] upgradeTank called for player ${this.id}`);
        console.log(`[PLAYER] Current tank: ${this.tankType}, Requested: ${newType}`);
        console.log(`[PLAYER] Current level: ${this.level}`);
        
        // Check if it's a test tank (starts with __)
        const isTestTank = newType.startsWith('__TEST_TANK__');
        console.log(`[PLAYER] Is test tank: ${isTestTank}`);
        
        if (isTestTank) {
            // For test tanks, bypass upgrade restrictions
            const newTank = TANK_TYPES[newType];
            if (newTank) {
                console.log(`[PLAYER] Test tank found in TANK_TYPES, upgrading directly`);
                this.tankType = newType;
                console.log(`[PLAYER] Tank upgraded to: ${this.tankType}`);
                return true;
            } else {
                console.log(`[PLAYER] ERROR: Test tank ${newType} not found in TANK_TYPES!`);
                return false;
            }
        }
        
        // Normal upgrade logic for regular tanks
        const availableUpgrades = TANK_UPGRADES[this.tankType] || [];
        console.log(`[PLAYER] Available upgrades:`, availableUpgrades);
        
        if (availableUpgrades.includes(newType)) {
            const newTank = TANK_TYPES[newType];
            if (this.level >= newTank.level) {
                console.log(`[PLAYER] Upgrade allowed, changing tank`);
                this.tankType = newType;
                return true;
            } else {
                console.log(`[PLAYER] Level too low: ${this.level} < ${newTank.level}`);
            }
        } else {
            console.log(`[PLAYER] Tank ${newType} not in available upgrades`);
        }
        return false;
    }
}

// Game state
const players = new Map();
const polygons = new Map();
const bullets = new Map();
const traps = new Map();
const minions = new Map();

function spawnPolygon() {
    if (polygons.size >= GAME_CONFIG.MAX_POLYGONS) return;

    // Random position with distance from center
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * (GAME_CONFIG.MAP_RADIUS - 100);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    
    // Calculate distance from center (0 to 1, where 1 is at edge)
    const distanceRatio = radius / GAME_CONFIG.MAP_RADIUS;
    
    // Decide polygon type based on location:
    // Center (0-0.3): Big polygons (60% Pentagon, 30% Hexagon, 10% Octagon+)
    // Mid (0.3-0.7): Medium polygons (50% Square, 40% Pentagon, 10% Hexagon)
    // Edge (0.7-1.0): Small polygons (70% Triangle, 25% Square, 5% Pentagon)
    
    let sides;
    const rand = Math.random();
    
    if (distanceRatio < 0.3) {
        // Center - spawn big polygons (tier 4 and 5 much rarer)
        if (rand < 0.60) sides = 5;          // 60% pentagons
        else if (rand < 0.90) sides = 6;     // 30% hexagons
        else if (rand < 0.97) sides = 8;     // 7% octagons
        else if (rand < 0.990) sides = 10;   // 2% decagons
        else if (rand < 0.996) sides = 12;   // 0.6% dodecagons (tier 4)
        else if (rand < 0.9985) sides = 13;  // 0.25% tridecagons (tier 4)
        else if (rand < 0.9995) sides = 14;  // 0.10% tetradecagons (tier 5 - rare)
        else if (rand < 0.99985) sides = 15; // 0.035% pentadecagons (tier 5 - very rare)
        else sides = 16;                      // 0.015% hexadecagons (tier 5 - ultra rare)
        
    } else if (distanceRatio < 0.7) {
        // Mid - spawn medium polygons
        if (rand < 0.50) sides = 4;        // 50% squares
        else if (rand < 0.90) sides = 5;   // 40% pentagons
        else sides = 6;                     // 10% hexagons
        
    } else {
        // Edge - spawn small polygons
        if (rand < 0.70) sides = 3;        // 70% triangles
        else if (rand < 0.95) sides = 4;   // 25% squares
        else sides = 5;                     // 5% pentagons
    }

    const polygon = new Polygon(x, y, sides);
    polygons.set(polygon.id, polygon);
}

function spawnPolygonCluster() {
    // Spawn a cluster of polygons at a random location
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * (GAME_CONFIG.MAP_RADIUS - 200);
    const centerX = Math.cos(angle) * radius;
    const centerY = Math.sin(angle) * radius;
    
    // Spawn 8-15 normal polygons (triangles, squares)
    const normalCount = Math.floor(Math.random() * 8) + 8; // 8-15
    for (let i = 0; i < normalCount; i++) {
        if (polygons.size >= GAME_CONFIG.MAX_POLYGONS) break;
        
        const offsetAngle = Math.random() * Math.PI * 2;
        const offsetDist = Math.random() * 150; // Cluster within 150 units
        const x = centerX + Math.cos(offsetAngle) * offsetDist;
        const y = centerY + Math.sin(offsetAngle) * offsetDist;
        
        // 60% triangles, 40% squares
        const sides = Math.random() < 0.6 ? 3 : 4;
        const polygon = new Polygon(x, y, sides);
        polygons.set(polygon.id, polygon);
    }
    
    // Spawn 2-4 good polygons (pentagons, hexagons, octagons)
    const goodCount = Math.floor(Math.random() * 3) + 2; // 2-4
    for (let i = 0; i < goodCount; i++) {
        if (polygons.size >= GAME_CONFIG.MAX_POLYGONS) break;
        
        const offsetAngle = Math.random() * Math.PI * 2;
        const offsetDist = Math.random() * 100; // Closer to center of cluster
        const x = centerX + Math.cos(offsetAngle) * offsetDist;
        const y = centerY + Math.sin(offsetAngle) * offsetDist;
        
        // 50% pentagons, 30% hexagons, 15% octagons, 5% higher
        const rand = Math.random();
        let sides;
        if (rand < 0.50) sides = 5;
        else if (rand < 0.80) sides = 6;
        else if (rand < 0.95) sides = 8;
        else sides = 10;
        
        const polygon = new Polygon(x, y, sides);
        polygons.set(polygon.id, polygon);
    }
    
    console.log(`Spawned cluster at (${Math.floor(centerX)}, ${Math.floor(centerY)}) with ${normalCount} normals and ${goodCount} good polygons`);
}

function checkCollision(obj1, obj2, size1, size2) {
    const dx = obj1.x - obj2.x;
    const dy = obj1.y - obj2.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance < (size1 + size2);
}

// Calculate distance from center to edge of base at given angle
function getBaseRadiusAtAngle(player, angle) {
    return getBaseRadiusAndFaceAtAngle(player, angle).radius;
}

function getBaseRadiusAndFaceAtAngle(player, angle) {
    const tankConfig = TANK_TYPES[player.tankType];
    
    // For circle or simple polygon base
    if (typeof tankConfig.baseShape === 'number') {
        const sides = tankConfig.baseShape;
        if (sides === 0) {
            // Circle - constant radius, face perpendicular to radius
            return { radius: player.size, faceAngle: angle };
        } else {
            // Regular polygon - calculate distance to edge at this angle
            const anglePerSide = (Math.PI * 2) / sides;
            
            // Cast a ray from origin at 'angle' and find intersection with polygon edges
            const rayDx = Math.cos(angle);
            const rayDy = Math.sin(angle);
            
            let minT = Infinity;
            let intersectEdgeIndex = 0;
            
            // Check all edges
            for (let i = 0; i < sides; i++) {
                // Get the two vertices of this edge
                const a1 = (i / sides) * Math.PI * 2 - Math.PI / 2;
                const a2 = ((i + 1) / sides) * Math.PI * 2 - Math.PI / 2;
                
                const v1x = Math.cos(a1) * player.size;
                const v1y = Math.sin(a1) * player.size;
                const v2x = Math.cos(a2) * player.size;
                const v2y = Math.sin(a2) * player.size;
                
                // Edge direction
                const edgeDx = v2x - v1x;
                const edgeDy = v2y - v1y;
                
                // Solve: origin + t * ray = v1 + s * edge
                const denom = rayDx * edgeDy - rayDy * edgeDx;
                if (Math.abs(denom) < 0.0001) continue; // Parallel
                
                const s = (rayDx * v1y - rayDy * v1x) / denom;
                const t = (v1x * edgeDy - v1y * edgeDx) / denom;
                
                // Check if intersection is on the edge (0 <= s <= 1) and in front (t > 0)
                if (s >= 0 && s <= 1 && t > 0 && t < minT) {
                    minT = t;
                    intersectEdgeIndex = i;
                }
            }
            
            const radius = minT < Infinity ? minT : player.size;
            
            // Calculate face angle (perpendicular to the edge)
            const edgeMidAngle = (intersectEdgeIndex + 0.5) / sides * Math.PI * 2 - Math.PI / 2;
            const faceAngle = edgeMidAngle;
            
            return { radius, faceAngle };
        }
    }
    
    // For advanced base with custom blocks, use conservative estimate (circle)
    return { radius: player.size, faceAngle: angle };
}

function findSafeSpawnPosition() {
    let attempts = 0;
    const maxAttempts = 50;
    
    while (attempts < maxAttempts) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 1500 + Math.random() * 1000; // Spawn far from center (1500-2500 units)
        const x = Math.cos(angle) * dist;
        const y = Math.sin(angle) * dist;
        
        let isSafe = true;
        const safeDistance = 300; // Increased from 100 to 300
        const polygonSafeDistance = 200; // Minimum distance from polygons
        
        // Check distance from other players
        players.forEach(player => {
            const dx = x - player.x;
            const dy = y - player.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < safeDistance) {
                isSafe = false;
            }
        });
        
        // Check distance from polygons
        polygons.forEach(polygon => {
            const dx = x - polygon.x;
            const dy = y - polygon.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < polygonSafeDistance) {
                isSafe = false;
            }
        });
        
        // Check distance from polygons
        if (isSafe) {
            polygons.forEach(polygon => {
                const dx = x - polygon.x;
                const dy = y - polygon.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < polygon.size + safeDistance) {
                    isSafe = false;
                }
            });
        }
        
        if (isSafe) {
            return { x, y };
        }
        
        attempts++;
    }
    
    // Fallback to center if no safe position found
    return { x: 0, y: 0 };
}

function gameLoop() {
    // Update players
    players.forEach(player => {
        player.update();

        // Update gun self-rotation angles
        const tankConfig = TANK_TYPES[player.tankType];
        if (tankConfig && tankConfig.guns) {
            tankConfig.guns.forEach((gun) => {
                if (gun.selfAngleSpeed && gun.selfAngleSpeed !== 0) {
                    // Update selfAngle based on speed (degrees per second)
                    // deltaTime is in seconds (1/TICK_RATE)
                    const deltaTime = 1 / GAME_CONFIG.TICK_RATE;
                    gun.selfAngle = (gun.selfAngle || 0) + gun.selfAngleSpeed * deltaTime;
                    // Keep angle in 0-360 range
                    gun.selfAngle = gun.selfAngle % 360;
                }
            });
        }

        // Shooting
        if (player.shooting) {
            const now = Date.now();
            const tankConfig = TANK_TYPES[player.tankType];
            
            tankConfig.guns.forEach((gun, gunIndex) => {
                // Each gun has its own reload time based on gun.reload multiplier
                const gunReloadTime = (500 / player.getReloadSpeed()) / (gun.reload || 1);
                const gunDelay = (gun.delay || 0) * 1000;
                const gunKey = `gun_${gunIndex}`;
                const lastGunShot = player.gunCooldowns[gunKey] || 0;
                
                // Check if this gun's reload time has passed
                if (now >= lastGunShot + gunReloadTime) {
                    // Check if gun has baked rotation (from advanced base export) or needs calculation
                    let gunAngle, startX, startY;
                    
                    if (gun.rotation !== undefined && gun.blockRotation === undefined && gun.selfAngle === undefined) {
                        // Baked gun: offsetX/offsetY are in tank's local space, rotation is relative to tank
                        const rotation = (gun.rotation || 0) * Math.PI / 180;
                        gunAngle = player.rotation + rotation;
                        
                        const offsetX = gun.offsetX || 0;
                        const offsetY = gun.offsetY || 0;
                        
                        // Spawn position: tank center + offsets rotated by player rotation
                        startX = player.x + Math.cos(player.rotation) * offsetX - Math.sin(player.rotation) * offsetY;
                        startY = player.y + Math.sin(player.rotation) * offsetX + Math.cos(player.rotation) * offsetY;
                    } else {
                        // Normal gun: calculate position and rotation from angle
                        let gunBaseAngle = (gun.angle || 0) * Math.PI / 180;
                        const blockRotation = (gun.blockRotation || 0) * Math.PI / 180;
                        const selfAngle = (gun.selfAngle || 0) * Math.PI / 180;
                        
                        // Get base radius and face angle at this position
                        const { radius: baseRadius, faceAngle } = getBaseRadiusAndFaceAtAngle(player, gunBaseAngle);
                        
                        // Calculate shooting angle: player rotation + gun position angle + face angle adjustment + additional rotations
                        const relativeAngle = player.rotation + gunBaseAngle;
                        const faceDiff = faceAngle - gunBaseAngle;
                        gunAngle = player.rotation + gunBaseAngle + faceDiff + blockRotation + selfAngle;
                        
                        const offsetX = gun.offsetX || 0;
                        const offsetY = gun.offsetY || 0;
                        
                        // Calculate bullet spawn position relative to tank
                        startX = player.x + Math.cos(relativeAngle) * (baseRadius + 10) + 
                                       Math.cos(relativeAngle + faceDiff) * offsetX +
                                       Math.cos(relativeAngle + faceDiff + Math.PI/2) * offsetY;
                        startY = player.y + Math.sin(relativeAngle) * (baseRadius + 10) + 
                                       Math.sin(relativeAngle + faceDiff) * offsetX +
                                       Math.sin(relativeAngle + faceDiff + Math.PI/2) * offsetY;
                    }
                    
                    if (gun.type === 'normal') {
                        const spread = gun.spread || 0;
                        const actualAngle = gunAngle + (Math.random() - 0.5) * spread;
                        const bulletSpeed = player.getBulletSpeed() * (gun.speed || 1);
                        const bulletDamage = player.getBulletDamage() * (gun.damage || 1);
                        // Bullet size scales with player size: base 8 * gun.size * player size factor
                        const playerSizeFactor = player.size / 20; // Base size is 20, so at level 0 it's 1x
                        const bulletSize = 8 * (gun.size || 1) * playerSizeFactor;
                        // Use custom bulletHealth if specified, otherwise use penetration stat
                        const bulletHealth = (gun.bulletHealth && gun.bulletHealth > 0) ? gun.bulletHealth * 10 : player.getBulletHealth();
                        
                        const bullet = new Bullet(startX, startY, actualAngle, player.id, 
                                                 bulletDamage, bulletSpeed, bulletSize, bulletHealth);
                        bullets.set(bullet.id, bullet);
                        
                        // Set gun recoil animation (10 pixels pushback)
                        player.gunRecoils[gunKey] = 10;
                        
                        // Recoil from shooting
                        const recoil = gun.recoil || 0;
                        if (recoil > 0) {
                            player.vx -= Math.cos(gunAngle) * recoil;
                            player.vy -= Math.sin(gunAngle) * recoil;
                        }
                    } else if (gun.type === 'trap') {
                        const maxTraps = gun.maxTraps || 10;
                        const playerTraps = Array.from(traps.values()).filter(t => t.owner === player.id);
                        const trapSize = (gun.trapSize || 1) * 15; // Base size 15, multiplied by trapSize
                        const shootDistance = gun.shootDistance || 8; // How far trap shoots out
                        const friction = gun.friction || 0.92; // Friction/deceleration
                        
                        if (playerTraps.length < maxTraps) {
                            const trap = new Trap(startX, startY, gunAngle, player.id, player.getBulletDamage() * (gun.damage || 1), trapSize, shootDistance, friction);
                            traps.set(trap.id, trap);
                            player.gunRecoils[gunKey] = 10; // Set recoil animation
                        } else {
                            // Remove oldest trap
                            const oldest = playerTraps[0];
                            traps.delete(oldest.id);
                            const trap = new Trap(startX, startY, gunAngle, player.id, player.getBulletDamage() * (gun.damage || 1), trapSize, shootDistance, friction);
                            traps.set(trap.id, trap);
                            player.gunRecoils[gunKey] = 10; // Set recoil animation
                        }
                        
                        // Recoil from shooting
                        const recoil = gun.recoil || 0;
                        if (recoil > 0) {
                            player.vx -= Math.cos(gunAngle) * recoil;
                            player.vy -= Math.sin(gunAngle) * recoil;
                        }
                    } else if (gun.type === 'minion') {
                        const count = gun.count || 4;
                        const playerMinions = Array.from(minions.values()).filter(m => m.owner === player.id);
                        const minionSize = (gun.minionSize || 1) * 12; // Base size 12, multiplied by minionSize
                        
                        if (playerMinions.length < count) {
                            const minionDamage = player.getBulletDamage() * (gun.damage || 1);
                            const minionSpeed = player.getBulletSpeed() * (gun.speed || 1);
                            const minionHealth = player.getBulletHealth();
                            
                            const minion = new Minion(startX, startY, player.id, 
                                                     minionDamage, minionSpeed, minionSize, 
                                                     minionHealth, player.stats.bulletPenetration);
                            minions.set(minion.id, minion);
                            player.gunRecoils[gunKey] = 10; // Set recoil animation
                        }
                        
                        // Recoil from shooting
                        const recoil = gun.recoil || 0;
                        if (recoil > 0) {
                            player.vx -= Math.cos(gunAngle) * recoil;
                            player.vy -= Math.sin(gunAngle) * recoil;
                        }
                    }
                    
                    // Update this gun's cooldown
                    player.gunCooldowns[gunKey] = now;
                }
            });
        }

        // Player vs polygon collision (softer overlap before pushback)
        polygons.forEach(polygon => {
            // Skip collision with dying polygons
            if (polygon.dying) return;
            
            const dx = player.x - polygon.x;
            const dy = player.y - polygon.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            // Player hitbox is slightly smaller (85% of visual size)
            const minDist = (player.size * 0.85) + polygon.size;
            
            if (dist < minDist) {
                // Check if tank has blade base
                const tankConfig = TANK_TYPES[player.tankType];
                const isBlade = tankConfig && tankConfig.baseShape === 'blade';
                // Tripled damage: Normal tanks deal 0.75 (3x0.25), blade tanks deal 3x
                const damageMultiplier = isBlade ? 3 : 0.75;
                const polygonDestroyed = polygon.takeDamage(player.getBodyDamage() * damageMultiplier);
                // Player takes 1/2 damage from polygons
                const playerDied = player.takeDamage((polygon.size * 2) / 32 / 2, {type: 'polygon', name: polygon.type});
                
                // Strong pushback - stronger the more overlapped, push until not touching
                if (!playerDied && dist > 0) {
                    const overlap = minDist - dist;
                    const pushForce = overlap * 0.8; // Strong pushback (increased from 0.5)
                    player.x += (dx / dist) * pushForce;
                    player.y += (dy / dist) * pushForce;
                    // Reduce velocity to prevent sliding through
                    player.vx *= 0.7;
                    player.vy *= 0.7;
                }
                
                if (polygonDestroyed) {
                    player.addXP(polygon.xp);
                    // Don't delete immediately - death animation will handle it
                }
                
                if (playerDied) {
                    // Send death info to killed player
                    const killedBy = [];
                    player.damageHistory.forEach(d => {
                        if (d.source.type === 'player') {
                            killedBy.push({type: 'player', name: d.source.name, tankType: d.source.tankType});
                        } else if (d.source.type === 'polygon') {
                            killedBy.push({type: 'polygon', name: d.source.name});
                        }
                    });
                    
                    // Remove duplicates
                    const uniqueKillers = [];
                    const seen = new Set();
                    killedBy.forEach(k => {
                        const key = k.type + '_' + k.name;
                        if (!seen.has(key)) {
                            seen.add(key);
                            uniqueKillers.push(k);
                        }
                    });
                    
                    io.to(player.id).emit('playerDied', {
                        killedBy: uniqueKillers,
                        spectateId: null
                    });
                    
                    // Don't auto-respawn - let client handle it
                    player.health = 0; // Keep at 0 to prevent further damage
                    player.vx = 0;
                    player.vy = 0;
                }
            }
        });

        // Player vs player collision (reduced body damage)
        players.forEach(otherPlayer => {
            if (player.id !== otherPlayer.id && player.health > 0 && otherPlayer.health > 0) {
                const dx = player.x - otherPlayer.x;
                const dy = player.y - otherPlayer.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                // Both players have 85% hitbox
                const minDist = (player.size * 0.85) + (otherPlayer.size * 0.85);
                
                if (dist < minDist) {
                    // Reduced body damage: 1/16 for player-player collisions (4x weaker than before)
                    const damage1 = player.getBodyDamage() / 16;
                    const damage2 = otherPlayer.getBodyDamage() / 16;
                    
                    player.takeDamage(damage2, {
                        type: 'player',
                        name: otherPlayer.name,
                        tankType: otherPlayer.tankType
                    });
                    
                    otherPlayer.takeDamage(damage1, {
                        type: 'player',
                        name: player.name,
                        tankType: player.tankType
                    });
                    
                    // Push players apart
                    if (dist > 0) {
                        const overlap = minDist - dist;
                        const pushForce = overlap * 0.5;
                        const nx = dx / dist;
                        const ny = dy / dist;
                        
                        player.x += nx * pushForce * 0.5;
                        player.y += ny * pushForce * 0.5;
                        otherPlayer.x -= nx * pushForce * 0.5;
                        otherPlayer.y -= ny * pushForce * 0.5;
                        
                        // Dampen velocities
                        player.vx *= 0.7;
                        player.vy *= 0.7;
                        otherPlayer.vx *= 0.7;
                        otherPlayer.vy *= 0.7;
                    }
                }
            }
        });
    });

    // Update bullets
    bullets.forEach(bullet => {
        bullet.update();

        // Remove if death animation complete
        if (bullet.isDeathComplete()) {
            bullets.delete(bullet.id);
            return;
        }

        // Check if out of bounds or expired
        const dist = Math.sqrt(bullet.x * bullet.x + bullet.y * bullet.y);
        if (dist > GAME_CONFIG.MAP_RADIUS || bullet.isExpired()) {
            bullets.delete(bullet.id); // Instantly remove when out of bounds or expired
            return;
        }

        // Bullet vs polygon
        polygons.forEach(polygon => {
            // Skip dying polygons
            if (polygon.dying || bullet.dying) return;
            
            if (checkCollision(bullet, polygon, bullet.size, polygon.size)) {
                const destroyed = polygon.takeDamage(bullet.damage);
                bullet.health -= 1;
                
                if (destroyed) {
                    const owner = players.get(bullet.owner);
                    if (owner) {
                        owner.addXP(polygon.xp);
                    }
                    // Don't delete immediately - death animation will handle it
                }
                
                if (bullet.health <= 0) {
                    bullet.startDeath();
                }
            }
        });

        // Bullet vs player
        players.forEach(player => {
            if (player.id !== bullet.owner && player.health > 0) {
                // Player hitbox is 85% of visual size
                if (checkCollision(bullet, player, bullet.size, player.size * 0.85)) {
                    const owner = players.get(bullet.owner);
                    // Bullets deal 50% damage to players
                    const damageToPlayer = bullet.damage * 0.5;
                    const destroyed = player.takeDamage(damageToPlayer, {
                        type: 'player',
                        name: owner ? owner.name : 'Unknown',
                        tankType: owner ? owner.tankType : 'BASIC'
                    });
                    bullet.health -= 1;
                    
                    if (destroyed) {
                        // Send death info to killed player
                        const killedBy = [];
                        player.damageHistory.forEach(d => {
                            if (d.source.type === 'player') {
                                killedBy.push({type: 'player', name: d.source.name, tankType: d.source.tankType});
                            } else if (d.source.type === 'polygon') {
                                killedBy.push({type: 'polygon', name: d.source.name});
                            }
                        });
                        
                        // Remove duplicates
                        const uniqueKillers = [];
                        const seen = new Set();
                        killedBy.forEach(k => {
                            const key = k.type + '_' + k.name;
                            if (!seen.has(key)) {
                                seen.add(key);
                                uniqueKillers.push(k);
                            }
                        });
                        
                        io.to(player.id).emit('playerDied', {
                            killedBy: uniqueKillers,
                            spectateId: owner ? owner.id : null
                        });
                        
                        if (owner && owner.health > 0) {
                            owner.addXP(player.score / 2);
                        }
                        
                        // Don't auto-respawn - let client handle it
                        player.health = 0;
                        player.vx = 0;
                        player.vy = 0;
                    }
                    
                    if (bullet.health <= 0) {
                        bullet.startDeath();
                    }
                }
            }
        });
        
        // Bullet vs trap (not owner's trap)
        traps.forEach(trap => {
            if (bullet.owner !== trap.owner && !bullet.dying && !trap.dying) {
                if (checkCollision(bullet, trap, bullet.size, trap.size)) {
                    trap.takeDamage(bullet.damage);
                    bullet.health -= 1;
                    
                    if (bullet.health <= 0) {
                        bullet.startDeath();
                    }
                }
            }
        });
        
        // Bullet vs bullet (not same owner)
        bullets.forEach(otherBullet => {
            if (bullet.id !== otherBullet.id && bullet.owner !== otherBullet.owner && 
                !bullet.dying && !otherBullet.dying) {
                if (checkCollision(bullet, otherBullet, bullet.size, otherBullet.size)) {
                    // Both bullets take damage
                    bullet.health -= 1;
                    otherBullet.health -= 1;
                    
                    if (bullet.health <= 0) {
                        bullet.startDeath();
                    }
                    if (otherBullet.health <= 0) {
                        otherBullet.startDeath();
                    }
                }
            }
        });
    });

    // Update traps
    traps.forEach(trap => {
        trap.update();
        
        // Remove if death animation complete
        if (trap.isDeathComplete()) {
            traps.delete(trap.id);
            return;
        }
        
        // Skip interactions if dying
        if (trap.dying) return;

        // Trap vs player (not owner)
        players.forEach(player => {
            if (player.id !== trap.owner && player.health > 0) {
                // Player hitbox is 85% of visual size
                if (checkCollision(trap, player, trap.size, player.size * 0.85)) {
                    const owner = players.get(trap.owner);
                    player.takeDamage(trap.damage, {
                        type: 'player',
                        name: owner ? owner.name : 'Unknown',
                        tankType: owner ? owner.tankType : 'BASIC'
                    });
                    trap.takeDamage(10);
                }
            }
        });

        // Trap vs polygon
        polygons.forEach(polygon => {
            // Skip dying polygons
            if (polygon.dying) return;
            
            const dx = trap.x - polygon.x;
            const dy = trap.y - polygon.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minDist = trap.size + polygon.size;
            
            if (dist < minDist) {
                const destroyed = polygon.takeDamage(trap.damage / 2);
                
                // Push trap away from polygon
                if (dist > 0) {
                    const overlap = minDist - dist;
                    const pushForce = overlap * 0.8; // Strong pushback
                    trap.x += (dx / dist) * pushForce;
                    trap.y += (dy / dist) * pushForce;
                    trap.vx *= 0.5; // Dampen velocity
                    trap.vy *= 0.5;
                }
                
                if (destroyed) {
                    const owner = players.get(trap.owner);
                    if (owner) {
                        owner.addXP(polygon.xp);
                    }
                    // Don't delete immediately - death animation will handle it
                }
            }
        });
    });

    // Update minions
    minions.forEach(minion => {
        const owner = players.get(minion.owner);
        if (owner) {
            minion.update(owner.mouseX, owner.mouseY, owner.x, owner.y, owner.shooting);
            
            // Remove if death animation complete
            if (minion.isDeathComplete()) {
                minions.delete(minion.id);
                return;
            }
            
            // Skip interactions if dying
            if (minion.dying) return;

            // Minion vs polygon
            polygons.forEach(polygon => {
                // Skip dying polygons
                if (polygon.dying) return;
                
                const dx = minion.x - polygon.x;
                const dy = minion.y - polygon.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const minDist = minion.size + polygon.size;
                
                if (dist < minDist) {
                    const destroyed = polygon.takeDamage(minion.damage);
                    minion.health -= 5;
                    
                    // Push minion away from polygon
                    if (dist > 0) {
                        const overlap = minDist - dist;
                        const pushForce = overlap * 0.8; // Strong pushback
                        minion.x += (dx / dist) * pushForce;
                        minion.y += (dy / dist) * pushForce;
                    }
                    
                    if (destroyed) {
                        owner.addXP(polygon.xp);
                        // Don't delete immediately - death animation will handle it
                    }
                    
                    if (minion.health <= 0) {
                        minion.startDeath();
                    }
                }
            });

            // Minion vs player (not owner)
            players.forEach(player => {
                if (player.id !== minion.owner && player.health > 0) {
                    // Player hitbox is 85% of visual size
                    if (checkCollision(minion, player, minion.size, player.size * 0.85)) {
                        player.takeDamage(minion.damage / 2, {
                            type: 'player',
                            name: owner ? owner.name : 'Unknown',
                            tankType: owner ? owner.tankType : 'BASIC'
                        });
                        minion.health -= 10;
                        
                        if (minion.health <= 0) {
                            minion.startDeath();
                        }
                    }
                }
            });

            // Minion vs bullet
            bullets.forEach(bullet => {
                if (bullet.owner !== minion.owner && !bullet.dying) {
                    if (checkCollision(minion, bullet, minion.size, bullet.size)) {
                        bullet.health -= minion.damage / 4;
                        minion.health -= bullet.damage / 4;
                        
                        if (bullet.health <= 0 && !bullet.dying) {
                            bullet.startDeath();
                        }
                        if (minion.health <= 0) {
                            minion.startDeath();
                        }
                    }
                }
            });

            // Minion vs trap
            traps.forEach(trap => {
                if (trap.owner !== minion.owner && !trap.dying) {
                    if (checkCollision(minion, trap, minion.size, trap.size)) {
                        trap.takeDamage(minion.damage / 2);
                        minion.health -= trap.damage / 2;
                        
                        if (minion.health <= 0) {
                            minion.startDeath();
                        }
                    }
                }
            });
        } else {
            minions.delete(minion.id);
        }
    });

    // Minion vs minion collision
    const minionArray = Array.from(minions.values());
    for (let i = 0; i < minionArray.length; i++) {
        for (let j = i + 1; j < minionArray.length; j++) {
            const minion1 = minionArray[i];
            const minion2 = minionArray[j];
            
            const dx = minion1.x - minion2.x;
            const dy = minion1.y - minion2.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minDist = minion1.size + minion2.size;
            
            if (dist < minDist && dist > 0) {
                // If they're from different owners, deal damage (skip if either is dying)
                if (minion1.owner !== minion2.owner && !minion1.dying && !minion2.dying) {
                    minion1.health -= 2;
                    minion2.health -= 2;
                    
                    if (minion1.health <= 0) {
                        minion1.startDeath();
                    }
                    if (minion2.health <= 0) {
                        minion2.startDeath();
                    }
                }
                
                // Push apart regardless of owner (only if not dying)
                if (!minion1.dying && !minion2.dying) {
                    const overlap = minDist - dist;
                    const pushForce = overlap * 0.5;
                    const nx = dx / dist;
                    const ny = dy / dist;
                    
                    minion1.x += nx * pushForce * 0.5;
                    minion1.y += ny * pushForce * 0.5;
                    minion2.x -= nx * pushForce * 0.5;
                    minion2.y -= ny * pushForce * 0.5;
                }
            }
        }
    }

    // Update polygons
    polygons.forEach(polygon => {
        polygon.update();
        
        // Remove polygons that finished death animation
        if (polygon.isDeathComplete()) {
            polygons.delete(polygon.id);
        }
    });

    // Polygon vs polygon collision
    const polygonArray = Array.from(polygons.values());
    for (let i = 0; i < polygonArray.length; i++) {
        for (let j = i + 1; j < polygonArray.length; j++) {
            const poly1 = polygonArray[i];
            const poly2 = polygonArray[j];
            
            // Skip dying polygons
            if (poly1.dying || poly2.dying) continue;
            
            const dx = poly1.x - poly2.x;
            const dy = poly1.y - poly2.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minDist = poly1.size + poly2.size;
            
            if (dist < minDist && dist > 0) {
                // Push apart
                const overlap = minDist - dist;
                const pushForce = overlap * 0.5;
                const nx = dx / dist;
                const ny = dy / dist;
                
                poly1.x += nx * pushForce * 0.5;
                poly1.y += ny * pushForce * 0.5;
                poly2.x -= nx * pushForce * 0.5;
                poly2.y -= ny * pushForce * 0.5;
                
                // Bounce velocities
                poly1.vx += nx * 0.1;
                poly1.vy += ny * 0.1;
                poly2.vx -= nx * 0.1;
                poly2.vy -= ny * 0.1;
            }
        }
    }

    // Spawn polygons
    if (Math.random() < GAME_CONFIG.POLYGON_SPAWN_RATE) {
        spawnPolygon();
    }

    // Send game state to clients
    const gameState = {
        players: Array.from(players.values())
            .filter(p => p.health > 0) // Only send alive players
            .map(p => ({
                id: p.id,
                name: p.name,
                x: p.x,
                y: p.y,
                rotation: p.rotation,
                size: p.size,
                health: p.health,
                maxHealth: p.getMaxHealth(),
                level: p.level,
                xp: p.xp,
                tankType: p.tankType,
                score: p.score,
                stats: p.stats,
                upgradePoints: p.upgradePoints,
                gunRecoils: p.gunRecoils
        })),
        polygons: Array.from(polygons.values()).map(p => ({
            id: p.id,
            x: p.x,
            y: p.y,
            sides: p.sides,
            size: p.size,
            color: p.color,
            rotation: p.rotation,
            health: p.health,
            maxHealth: p.maxHealth,
            dying: p.dying,
            deathProgress: p.dying ? p.getDeathProgress() : 0,
            baseSize: p.baseSize
        })),
        bullets: Array.from(bullets.values()).map(b => ({
            id: b.id,
            x: b.x,
            y: b.y,
            size: b.size,
            rotation: b.angle,
            dying: b.dying,
            deathProgress: b.getDeathProgress()
        })),
        traps: Array.from(traps.values()).map(t => ({
            id: t.id,
            x: t.x,
            y: t.y,
            size: t.size,
            rotation: t.rotation,
            health: t.health,
            maxHealth: t.maxHealth,
            dying: t.dying,
            deathProgress: t.getDeathProgress()
        })),
        minions: Array.from(minions.values()).map(m => ({
            id: m.id,
            x: m.x,
            y: m.y,
            size: m.size,
            rotation: m.rotation,
            health: m.health,
            maxHealth: m.maxHealth,
            dying: m.dying,
            deathProgress: m.getDeathProgress()
        }))
    };

    io.emit('gameState', gameState);
}

// AFK kick system - check every 30 seconds
function checkAFKPlayers() {
    const now = Date.now();
    const AFK_TIMEOUT = 120000; // 2 minutes in milliseconds
    
    players.forEach((player, socketId) => {
        const afkTime = now - player.lastActivityTime;
        
        if (afkTime > AFK_TIMEOUT) {
            const afkMinutes = Math.floor(afkTime / 60000);
            console.log(`[${new Date().toLocaleTimeString()}] ⏰ Kicking AFK player: "${player.name}" (${socketId}) - Inactive for ${afkMinutes} min`);
            
            // Get socket and disconnect
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
                socket.emit('afkKick', { reason: 'Kicked for inactivity (2 minutes)' });
                socket.disconnect(true);
            }
            
            // Clean up player data
            players.delete(socketId);
            bullets.forEach((bullet, id) => {
                if (bullet.owner === socketId) bullets.delete(id);
            });
            traps.forEach((trap, id) => {
                if (trap.owner === socketId) traps.delete(id);
            });
            minions.forEach((minion, id) => {
                if (minion.owner === socketId) minions.delete(id);
            });
        }
    });
}

setInterval(checkAFKPlayers, 30000); // Check every 30 seconds

// Socket.IO events
io.on('connection', (socket) => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ✅ Player connected: ${socket.id} | Total players: ${players.size + 1}`);

    socket.on('joinGame', (name) => {
        const spawnPos = findSafeSpawnPosition();
        const player = new Player(spawnPos.x, spawnPos.y, name || 'Tank');
        player.id = socket.id; // Set player ID to socket ID so client can find itself
        players.set(socket.id, player);
        
        // Start game loop if this is the first player
        if (players.size === 1 && !isServerActive) {
            startGameLoop();
        }
        
        // Extract upgrade paths from TANK_TYPES for client
        const tankUpgrades = {};
        Object.keys(TANK_TYPES).forEach(key => {
            tankUpgrades[key] = TANK_TYPES[key].upgrades || [];
        });
        
        socket.emit('playerJoined', {
            id: socket.id,
            tankTypes: TANK_TYPES,
            tankUpgrades: tankUpgrades
        });
        
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] 🎮 Player joined game: "${player.name}" (${socket.id})`);
    });

    socket.on('playerInput', (input) => {
        const player = players.get(socket.id);
        if (player) {
            player.moving = input.moving;
            player.shooting = input.shooting;
            player.mouseX = input.mouseX;
            player.mouseY = input.mouseY;
            
            // Update activity time on any input
            player.lastActivityTime = Date.now();
        }
    });

    socket.on('upgradeStat', (stat) => {
        const player = players.get(socket.id);
        if (player) {
            player.upgradeStat(stat);
        }
    });

    socket.on('upgradeTank', (tankType) => {
        console.log(`[SERVER] upgradeTank called for socket ${socket.id}, tankType: ${tankType}`);
        const player = players.get(socket.id);
        if (player) {
            console.log(`[SERVER] Player found, current tankType: ${player.tankType}, upgrading to: ${tankType}`);
            console.log(`[SERVER] Tank config exists in TANK_TYPES: ${!!TANK_TYPES[tankType]}`);
            if (TANK_TYPES[tankType]) {
                console.log(`[SERVER] Tank config:`, TANK_TYPES[tankType]);
            }
            player.upgradeTank(tankType);
            console.log(`[SERVER] upgradeTank called, new tankType: ${player.tankType}`);
        } else {
            console.log(`[SERVER] Player not found for socket ${socket.id}`);
        }
    });

    // Handle test tank registration
    socket.on('setTestTank', ({ tankName, config }) => {
        console.log(`[SERVER] setTestTank received for ${tankName}`);
        console.log(`[SERVER] Tank config:`, JSON.stringify(config, null, 2));
        // Temporarily add test tank to server's TANK_TYPES
        TANK_TYPES[tankName] = config;
        console.log(`[SERVER] Test tank ${tankName} registered successfully`);
        console.log(`[SERVER] Total tanks in TANK_TYPES: ${Object.keys(TANK_TYPES).length}`);
        
        // Confirm registration to client
        socket.emit('testTankRegistered', { tankName });
        console.log(`[SERVER] Sent testTankRegistered confirmation to client`);
    });

    socket.on('clearTestTank', (tankName) => {
        console.log(`[SERVER] clearTestTank received for ${tankName}`);
        // Remove test tank from server
        delete TANK_TYPES[tankName];
        console.log(`[SERVER] Test tank ${tankName} removed`);
    });

    socket.on('respawn', () => {
        const player = players.get(socket.id);
        if (player && player.health <= 0) {
            // Remove player's bullets, traps, and minions
            bullets.forEach((bullet, id) => {
                if (bullet.owner === socket.id) bullets.delete(id);
            });
            traps.forEach((trap, id) => {
                if (trap.owner === socket.id) traps.delete(id);
            });
            minions.forEach((minion, id) => {
                if (minion.owner === socket.id) minions.delete(id);
            });
            
            const spawnPos = findSafeSpawnPosition();
            player.x = spawnPos.x;
            player.y = spawnPos.y;
            player.health = player.getMaxHealth();
            player.score = 0; // Score always resets
            player.vx = 0;
            player.vy = 0;
            player.damageHistory = [];
            
            // Keep 1/3 of XP (rounded down)
            const keptXP = Math.floor(player.xp / 3);
            player.xp = keptXP;
            player.level = 0; // Reset to level 0
            player.upgradePoints = 0; // Remove all upgrade points
            
            // Auto-level up with kept XP
            while (player.xp >= player.level * 100) {
                const requiredXP = player.level * 100;
                player.xp -= requiredXP;
                player.level++;
                player.updateSize();
                
                // Award upgrade points
                if (player.level <= 5) {
                    player.upgradePoints += 1;
                } else if ((player.level - 5) % 2 === 1) {
                    player.upgradePoints += 1;
                }
            }
            
            // Reset to basic tank and clear stats
            player.tankType = 'BASIC';
            player.stats = {
                healthRegen: 0,
                maxHealth: 0,
                bodyDamage: 0,
                bulletSpeed: 0,
                bulletPenetration: 0,
                bulletDamage: 0,
                reload: 0,
                movementSpeed: 0
            };
            
            console.log(`[${new Date().toLocaleTimeString()}] 🔄 "${player.name}" respawned with ${keptXP} XP (level ${player.level})`);
        }
    });

    socket.on('chatMessage', (message) => {
        const player = players.get(socket.id);
        if (player && message && typeof message === 'string') {
            // Sanitize and limit message length
            const sanitizedMessage = message.trim().substring(0, 100);
            if (sanitizedMessage.length > 0) {
                // Broadcast to all players
                io.emit('chatMessage', {
                    name: player.name,
                    message: sanitizedMessage
                });
            }
        }
    });

    // Admin panel verification
    const ADMIN_CODE = 'ronnyisskibidi';
    const adminPlayers = new Set(); // Track verified admin players

    socket.on('verifyAdminCode', (code) => {
        if (code === ADMIN_CODE) {
            adminPlayers.add(socket.id);
            console.log(`Admin access granted to: ${socket.id}`);
            socket.emit('adminVerified', true);
        } else {
            socket.emit('adminVerified', false);
        }
    });

    // Cheat code handlers (now require admin verification)
    socket.on('cheatGiveXP', (amount) => {
        if (!adminPlayers.has(socket.id)) return;
        const player = players.get(socket.id);
        if (player) {
            player.addXP(amount);
        }
    });

    socket.on('cheatMaxStats', () => {
        if (!adminPlayers.has(socket.id)) return;
        const player = players.get(socket.id);
        if (player) {
            player.level = 1000;
            player.stats = {
                healthRegen: 7,
                maxHealth: 7,
                bodyDamage: 7,
                bulletSpeed: 7,
                bulletPenetration: 7,
                bulletDamage: 7,
                reload: 7,
                movementSpeed: 7
            };
        }
    });

    socket.on('cheatResetTank', () => {
        if (!adminPlayers.has(socket.id)) return;
        const player = players.get(socket.id);
        if (player) {
            player.tankType = 'BASIC';
            player.level = 0;
            player.xp = 0;
            player.upgradePoints = 0;
            player.stats = {
                healthRegen: 0,
                maxHealth: 0,
                bodyDamage: 0,
                bulletSpeed: 0,
                bulletPenetration: 0,
                bulletDamage: 0,
                reload: 0,
                movementSpeed: 0
            };
            player.updateSize();
            console.log('Player reset tank:', socket.id);
        }
    });

    socket.on('cheatMorphTank', (tankType) => {
        if (!adminPlayers.has(socket.id)) return;
        const player = players.get(socket.id);
        if (player && TANK_TYPES[tankType]) {
            player.tankType = tankType;
            console.log(`Player ${player.name} morphed to ${tankType}`);
        }
    });

    socket.on('cheatSpawnPolygon', (data) => {
        if (!adminPlayers.has(socket.id)) return;
        const { type, x, y } = data;
        
        // Map of sides to polygon config
        const polygonConfigs = {
            3: { size: 15, health: 300, xp: 10, color: '#FFE666', name: 'Triangle' },
            4: { size: 20, health: 400, xp: 20, color: '#FFC866', name: 'Square' },
            5: { size: 30, health: 600, xp: 100, color: '#768CFF', name: 'Pentagon' },
            6: { size: 40, health: 800, xp: 200, color: '#FF6B9D', name: 'Hexagon' },
            8: { size: 50, health: 1000, xp: 400, color: '#8B66FF', name: 'Octagon' },
            10: { size: 60, health: 1200, xp: 800, color: '#66CCFF', name: 'Decagon' },
            12: { size: 70, health: 1400, xp: 1600, color: '#FF6666', name: 'Dodecagon' },
            13: { size: 75, health: 1600, xp: 2000, color: '#FF9966', name: '13-gon' },
            14: { size: 80, health: 1800, xp: 2500, color: '#66FF99', name: '14-gon' },
            15: { size: 85, health: 2000, xp: 3000, color: '#9966FF', name: '15-gon' },
            16: { size: 90, health: 2200, xp: 3500, color: '#FF66CC', name: '16-gon' }
        };
        
        if (polygonConfigs[type]) {
            const config = polygonConfigs[type];
            const polygon = new Polygon(x, y, type, config.size, config.health, config.xp, config.color, config.name);
            polygons.set(polygon.id, polygon);
        }
    });

    socket.on('cheatToggleInvincibility', () => {
        if (!adminPlayers.has(socket.id)) return;
        const player = players.get(socket.id);
        if (player) {
            player.invincible = !player.invincible;
            console.log(`Player ${player.name} invincibility:`, player.invincible);
        }
    });

    socket.on('cheatTeleportPlayers', (data) => {
        if (!adminPlayers.has(socket.id)) return;
        const { x, y, mode } = data;
        
        if (mode === 'all') {
            // Teleport all players
            players.forEach(player => {
                player.x = x;
                player.y = y;
                player.vx = 0;
                player.vy = 0;
            });
            console.log(`Teleported all players to (${x}, ${y})`);
        } else if (mode === 'others') {
            // Teleport all except the admin
            players.forEach((player, id) => {
                if (id !== socket.id) {
                    player.x = x;
                    player.y = y;
                    player.vx = 0;
                    player.vy = 0;
                }
            });
            console.log(`Teleported all other players to (${x}, ${y})`);
        } else if (mode === 'you') {
            // Teleport only the admin
            const player = players.get(socket.id);
            if (player) {
                player.x = x;
                player.y = y;
                player.vx = 0;
                player.vy = 0;
                console.log(`Teleported admin to (${x}, ${y})`);
            }
        }
    });

    socket.on('cheatClearPolygons', () => {
        if (!adminPlayers.has(socket.id)) return;
        const count = polygons.size;
        polygons.clear();
        console.log(`Admin ${socket.id} cleared ${count} polygons from map`);
    });

    socket.on('cheatMorphAdmin', () => {
        if (!adminPlayers.has(socket.id)) return;
        const player = players.get(socket.id);
        if (player) {
            player.tankType = 'ADMIN';
            player.level = 100;
            player.stats = {
                healthRegen: 7,
                maxHealth: 7,
                bodyDamage: 7,
                bulletSpeed: 7,
                bulletPenetration: 7,
                bulletDamage: 7,
                reload: 7,
                movementSpeed: 7
            };
            player.updateSize();
            console.log(`Player ${player.name} morphed to ADMIN tank`);
        }
    });

    socket.on('playerLeaveGame', () => {
        console.log('Player left game:', socket.id);
        players.delete(socket.id);
        
        // Remove player's bullets, traps, and minions
        bullets.forEach((bullet, id) => {
            if (bullet.owner === socket.id) bullets.delete(id);
        });
        traps.forEach((trap, id) => {
            if (trap.owner === socket.id) traps.delete(id);
        });
        minions.forEach((minion, id) => {
            if (minion.owner === socket.id) minions.delete(id);
        });
    });

    socket.on('disconnect', () => {
        const timestamp = new Date().toLocaleTimeString();
        const player = players.get(socket.id);
        const playerName = player ? player.name : 'Unknown';
        
        console.log(`[${timestamp}] ❌ Player disconnected: "${playerName}" (${socket.id}) | Remaining: ${players.size - 1}`);
        
        players.delete(socket.id);
        adminPlayers.delete(socket.id); // Remove from admin list
        
        // Remove player's bullets, traps, and minions
        bullets.forEach((bullet, id) => {
            if (bullet.owner === socket.id) bullets.delete(id);
        });
        traps.forEach((trap, id) => {
            if (trap.owner === socket.id) traps.delete(id);
        });
        minions.forEach((minion, id) => {
            if (minion.owner === socket.id) minions.delete(id);
        });
    });
});

// Idle server management
let gameLoopInterval = null;
let polygonSpawnInterval = null;
let isServerActive = false;
let lastPlayerTime = Date.now();
let idleCheckInterval = null;

function startGameLoop() {
    if (isServerActive) return; // Already running
    
    isServerActive = true;
    console.log(`[${new Date().toLocaleTimeString()}] 🟢 Game loop STARTED`);
    
    // Start game loop
    gameLoopInterval = setInterval(gameLoop, 1000 / GAME_CONFIG.TICK_RATE);
    
    // Start polygon spawning
    polygonSpawnInterval = setInterval(() => {
        spawnPolygonCluster();
    }, 30000);
    
    // Spawn initial polygons if needed
    if (polygons.size < 50) {
        for (let i = polygons.size; i < 50; i++) {
            spawnPolygon();
        }
    }
}

function stopGameLoop() {
    if (!isServerActive) return; // Already stopped
    
    isServerActive = false;
    console.log(`[${new Date().toLocaleTimeString()}] 🔴 Game loop STOPPED (no players)`);
    
    // Stop game loop
    if (gameLoopInterval) {
        clearInterval(gameLoopInterval);
        gameLoopInterval = null;
    }
    
    // Stop polygon spawning
    if (polygonSpawnInterval) {
        clearInterval(polygonSpawnInterval);
        polygonSpawnInterval = null;
    }
}

function checkIdleStatus() {
    const now = Date.now();
    const idleTime = (now - lastPlayerTime) / 1000; // seconds
    
    if (players.size > 0) {
        lastPlayerTime = now;
        if (!isServerActive) {
            console.log(`[${new Date().toLocaleTimeString()}] ⚡ Players detected, starting game loop...`);
            startGameLoop();
        }
    } else if (isServerActive && idleTime > 180) { // 3 minutes = 180 seconds
        console.log(`[${new Date().toLocaleTimeString()}] 💤 No players for 3 minutes, stopping game loop...`);
        stopGameLoop();
    }
}

// Check for idle every 10 seconds
idleCheckInterval = setInterval(checkIdleStatus, 10000);

// Initial polygons (only spawn if we start with players)
for (let i = 0; i < 50; i++) {
    spawnPolygon();
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log('=================================');
    console.log('   RONNY IO - Version 2.0');
    console.log('=================================');
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Time: ${new Date().toLocaleString()}`);
    console.log('=================================');
});

// Server activity logging (only log if server is active)
setInterval(() => {
    if (!isServerActive) return; // Don't log when idle
    
    const playerCount = players.size;
    const polygonCount = polygons.size;
    const bulletCount = bullets.size;
    const trapCount = traps.size;
    const minionCount = minions.size;
    
    console.log(`[${new Date().toLocaleTimeString()}] Players: ${playerCount} | Polygons: ${polygonCount} | Bullets: ${bulletCount} | Traps: ${trapCount} | Minions: ${minionCount}`);
}, 60000); // Log every 60 seconds

// Log player activity
let lastActivityTime = Date.now();
setInterval(() => {
    const now = Date.now();
    const idleMinutes = Math.floor((now - lastPlayerTime) / 60000);
    
    if (players.size > 0) {
        lastActivityTime = now;
    } else if (idleMinutes >= 1 && !isServerActive) {
        console.log(`[${new Date().toLocaleTimeString()}] 💤 Server sleeping (idle for ${idleMinutes} minute(s))`);
    }
}, 300000); // Check every 5 minutes
