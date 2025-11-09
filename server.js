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
        // Special health calculation for triangles (lower health)
        if (sides === 3) {
            this.health = this.size * 10; // Reduced health for triangles
        } else {
            this.health = this.size * 20 * 3; // Tripled health for others (was size * 20)
        }
        this.maxHealth = this.health;
        this.xp = Math.floor(this.size * 5 * sides);
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
        const sizes = {3: 12, 4: 18, 5: 25, 6: 35, 8: 50, 10: 70, 12: 90, 13: 110, 14: 130, 15: 150, 16: 170};
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
    constructor(x, y, angle, owner, damage, size = 15) {
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
        
        // Initial movement - shoot out faster
        this.vx = Math.cos(angle) * 8; // Increased from 3 to 8
        this.vy = Math.sin(angle) * 8;
        this.friction = 0.92; // Slower deceleration (was 0.9)
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= this.friction;
        this.vy *= this.friction;
        this.rotation += this.rotationSpeed;
    }
    
    takeDamage(amount) {
        this.health -= amount;
        return this.health <= 0;
    }
}

class Minion extends GameObject {
    constructor(x, y, owner, damage, speed, size = 12, health = 30, penetration = 1) {
        super(x, y);
        this.owner = owner;
        this.damage = damage;
        this.speed = speed * 1.5; // Reduced from 5 to 1.5 for more reasonable speed
        this.size = size;
        this.health = health;
        this.maxHealth = health;
        this.penetration = penetration; // For future use if needed
        this.targetX = x;
        this.targetY = y;
        this.rotation = 0;
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
            this.x += (dx / dist) * this.speed;
            this.y += (dy / dist) * this.speed;
        }

        // Smooth rotation interpolation
        const targetRotation = Math.atan2(dy, dx);
        let angleDiff = targetRotation - this.rotation;
        
        // Normalize angle difference to [-PI, PI]
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        
        this.rotation += angleDiff * 0.15;
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
        return (this.maxHealth + (this.stats.maxHealth * 20)) * healthBonus;
    }

    getRegenRate() {
        return 0.5 + (this.stats.healthRegen * 0.5);
    }

    getBodyDamage() {
        const tankConfig = TANK_TYPES[this.tankType];
        const bonus = tankConfig.bodyDamageBonus || 1;
        return (10 + this.stats.bodyDamage * 2) * bonus; // Reduced from 5 to 2
    }

    getBulletSpeed() {
        return 6 + this.stats.bulletSpeed * 0.6; // Reduced from 8 + 0.8 to 6 + 0.6
    }

    getBulletDamage() {
        return 20 + this.stats.bulletDamage * 5;
    }

    getBulletHealth() {
        return 10 + this.stats.bulletPenetration * 5;
    }

    getReloadSpeed() {
        return 1 + this.stats.reload * 0.15;
    }

    getMoveSpeed() {
        const tankConfig = TANK_TYPES[this.tankType];
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
        // Get upgrades from JSON file
        const availableUpgrades = TANK_UPGRADES[this.tankType] || [];
        if (availableUpgrades.includes(newType)) {
            const newTank = TANK_TYPES[newType];
            if (this.level >= newTank.level) {
                this.tankType = newType;
                return true;
            }
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
        // Center - spawn big polygons (including rare ultra-large ones)
        if (rand < 0.60) sides = 5;          // 60% pentagons
        else if (rand < 0.90) sides = 6;     // 30% hexagons
        else if (rand < 0.97) sides = 8;     // 7% octagons
        else if (rand < 0.990) sides = 10;   // 2% decagons
        else if (rand < 0.997) sides = 12;   // 0.7% dodecagons
        else if (rand < 0.9985) sides = 13;  // 0.15% tridecagons
        else if (rand < 0.9995) sides = 14;  // 0.10% tetradecagons
        else if (rand < 0.9999) sides = 15;  // 0.04% pentadecagons
        else sides = 16;                      // 0.01% hexadecagons (ultra rare)
        
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
                    const gunAngle = player.rotation + (gun.angle * Math.PI / 180);
                    const offsetX = gun.offsetX || 0;
                    const offsetY = gun.offsetY || 0;
                    
                    const startX = player.x + Math.cos(gunAngle) * (player.size + 10) + 
                                   Math.cos(gunAngle + Math.PI/2) * offsetY +
                                   Math.cos(gunAngle) * offsetX;
                    const startY = player.y + Math.sin(gunAngle) * (player.size + 10) + 
                                   Math.sin(gunAngle + Math.PI/2) * offsetY +
                                   Math.sin(gunAngle) * offsetX;
                    
                    if (gun.type === 'normal') {
                        const spread = gun.spread || 0;
                        const actualAngle = gunAngle + (Math.random() - 0.5) * spread;
                        const bulletSpeed = player.getBulletSpeed() * (gun.speed || 1);
                        const bulletDamage = player.getBulletDamage() * (gun.damage || 1);
                        // Bullet size scales with player size: base 8 * gun.size * player size factor
                        const playerSizeFactor = player.size / 20; // Base size is 20, so at level 0 it's 1x
                        const bulletSize = 8 * (gun.size || 1) * playerSizeFactor;
                        const bulletHealth = player.getBulletHealth();
                        
                        const bullet = new Bullet(startX, startY, actualAngle, player.id, 
                                                 bulletDamage, bulletSpeed, bulletSize, bulletHealth);
                        bullets.set(bullet.id, bullet);
                        
                        // Set gun recoil animation (10 pixels pushback)
                        player.gunRecoils[gunKey] = 10;
                        
                        // Recoil from shooting
                        const recoil = gun.recoil || 0;
                        const shootingKnockback = 0.3; // Slight knockback from firing
                        const totalKnockback = recoil + shootingKnockback;
                        if (totalKnockback > 0) {
                            player.vx -= Math.cos(gunAngle) * totalKnockback;
                            player.vy -= Math.sin(gunAngle) * totalKnockback;
                        }
                    } else if (gun.type === 'trap') {
                        const maxTraps = gun.maxTraps || 10;
                        const playerTraps = Array.from(traps.values()).filter(t => t.owner === player.id);
                        const trapSize = (gun.trapSize || 1) * 15; // Base size 15, multiplied by trapSize
                        
                        if (playerTraps.length < maxTraps) {
                            const trap = new Trap(startX, startY, gunAngle, player.id, player.getBulletDamage() * (gun.damage || 1), trapSize);
                            traps.set(trap.id, trap);
                            player.gunRecoils[gunKey] = 10; // Set recoil animation
                        } else {
                            // Remove oldest trap
                            const oldest = playerTraps[0];
                            traps.delete(oldest.id);
                            const trap = new Trap(startX, startY, gunAngle, player.id, player.getBulletDamage() * (gun.damage || 1), trapSize);
                            traps.set(trap.id, trap);
                            player.gunRecoils[gunKey] = 10; // Set recoil animation
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
            const minDist = player.size + polygon.size;
            
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
                const minDist = player.size + otherPlayer.size;
                
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
            if (player.id !== bullet.owner) {
                if (checkCollision(bullet, player, bullet.size, player.size)) {
                    const owner = players.get(bullet.owner);
                    const destroyed = player.takeDamage(bullet.damage, {
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
                        
                        if (owner) {
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
            if (bullet.owner !== trap.owner && !bullet.dying) {
                if (checkCollision(bullet, trap, bullet.size, trap.size)) {
                    const trapDestroyed = trap.takeDamage(bullet.damage);
                    bullet.health -= 1;
                    
                    if (trapDestroyed) {
                        traps.delete(trap.id);
                    }
                    
                    if (bullet.health <= 0) {
                        bullet.startDeath();
                    }
                }
            }
        });
    });

    // Update traps
    traps.forEach(trap => {
        trap.update();

        // Trap vs player (not owner)
        players.forEach(player => {
            if (player.id !== trap.owner) {
                if (checkCollision(trap, player, trap.size, player.size)) {
                    const owner = players.get(trap.owner);
                    player.takeDamage(trap.damage, {
                        type: 'player',
                        name: owner ? owner.name : 'Unknown',
                        tankType: owner ? owner.tankType : 'BASIC'
                    });
                    trap.health -= 10;
                    
                    if (trap.health <= 0) {
                        traps.delete(trap.id);
                    }
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
                        minions.delete(minion.id);
                    }
                }
            });

            // Minion vs player (not owner)
            players.forEach(player => {
                if (player.id !== minion.owner) {
                    if (checkCollision(minion, player, minion.size, player.size)) {
                        player.takeDamage(minion.damage / 2, {
                            type: 'player',
                            name: owner ? owner.name : 'Unknown',
                            tankType: owner ? owner.tankType : 'BASIC'
                        });
                        minion.health -= 10;
                        
                        if (minion.health <= 0) {
                            minions.delete(minion.id);
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
                            minions.delete(minion.id);
                        }
                    }
                }
            });

            // Minion vs trap
            traps.forEach(trap => {
                if (trap.owner !== minion.owner) {
                    if (checkCollision(minion, trap, minion.size, trap.size)) {
                        trap.health -= minion.damage / 2;
                        minion.health -= trap.damage / 2;
                        
                        if (trap.health <= 0) {
                            traps.delete(trap.id);
                        }
                        if (minion.health <= 0) {
                            minions.delete(minion.id);
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
                // If they're from different owners, deal damage
                if (minion1.owner !== minion2.owner) {
                    minion1.health -= 2;
                    minion2.health -= 2;
                    
                    if (minion1.health <= 0) {
                        minions.delete(minion1.id);
                    }
                    if (minion2.health <= 0) {
                        minions.delete(minion2.id);
                    }
                }
                
                // Push apart regardless of owner
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
            maxHealth: t.maxHealth
        })),
        minions: Array.from(minions.values()).map(m => ({
            id: m.id,
            x: m.x,
            y: m.y,
            size: m.size,
            rotation: m.rotation,
            health: m.health,
            maxHealth: m.maxHealth
        }))
    };

    io.emit('gameState', gameState);
}

// Socket.IO events
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('joinGame', (name) => {
        const spawnPos = findSafeSpawnPosition();
        const player = new Player(spawnPos.x, spawnPos.y, name || 'Tank');
        player.id = socket.id; // Set player ID to socket ID so client can find itself
        players.set(socket.id, player);
        
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
        
        console.log('Player joined game:', socket.id, 'Name:', player.name);
    });

    socket.on('playerInput', (input) => {
        const player = players.get(socket.id);
        if (player) {
            player.moving = input.moving;
            player.shooting = input.shooting;
            player.mouseX = input.mouseX;
            player.mouseY = input.mouseY;
        }
    });

    socket.on('upgradeStat', (stat) => {
        const player = players.get(socket.id);
        if (player) {
            player.upgradeStat(stat);
        }
    });

    socket.on('upgradeTank', (tankType) => {
        const player = players.get(socket.id);
        if (player) {
            player.upgradeTank(tankType);
        }
    });

    // Handle test tank registration
    socket.on('setTestTank', ({ tankName, config }) => {
        // Temporarily add test tank to server's TANK_TYPES
        TANK_TYPES[tankName] = config;
        console.log(`Test tank ${tankName} registered for testing`);
    });

    socket.on('clearTestTank', (tankName) => {
        // Remove test tank from server
        delete TANK_TYPES[tankName];
        console.log(`Test tank ${tankName} removed`);
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
            player.score = 0;
            player.vx = 0;
            player.vy = 0;
            player.damageHistory = [];
            player.level = 0; // Start at level 0
            player.xp = 0;
            player.upgradePoints = 0; // Remove all upgrade points
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
        const polygonTypes = [
            { sides: 3, size: 15, health: 300, xp: 10, color: '#FFE666', type: 'Triangle' },
            { sides: 4, size: 20, health: 400, xp: 20, color: '#FFC866', type: 'Square' },
            { sides: 5, size: 30, health: 600, xp: 100, color: '#768CFF', type: 'Pentagon' },
            { sides: 6, size: 40, health: 800, xp: 200, color: '#FF6B9D', type: 'Hexagon' },
            { sides: 8, size: 50, health: 1000, xp: 400, color: '#8B66FF', type: 'Octagon' },
            { sides: 10, size: 60, health: 1200, xp: 800, color: '#66CCFF', type: 'Decagon' },
            { sides: 12, size: 70, health: 1400, xp: 1600, color: '#FF6666', type: 'Dodecagon' }
        ];
        
        if (type >= 1 && type <= 7) {
            const config = polygonTypes[type - 1];
            const polygon = new Polygon(x, y, config.sides, config.size, config.health, config.xp, config.color, config.type);
            polygons.set(polygon.id, polygon);
        } else if (type === 8) {
            // Special: spawn all types in a circle
            const radius = 100;
            polygonTypes.forEach((config, i) => {
                const angle = (i / polygonTypes.length) * Math.PI * 2;
                const px = x + Math.cos(angle) * radius;
                const py = y + Math.sin(angle) * radius;
                const polygon = new Polygon(px, py, config.sides, config.size, config.health, config.xp, config.color, config.type);
                polygons.set(polygon.id, polygon);
            });
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
        console.log('Player disconnected:', socket.id);
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

// Start game loop
setInterval(gameLoop, 1000 / GAME_CONFIG.TICK_RATE);

// Spawn polygon clusters every 30 seconds
setInterval(() => {
    spawnPolygonCluster();
}, 30000);

// Initial polygons
for (let i = 0; i < 50; i++) {
    spawnPolygon();
}

const PORT = process.env.PORT || 13126;
http.listen(PORT, () => {
    console.log('=================================');
    console.log('   RONNY IO - Version 2.0');
    console.log('=================================');
    console.log(`Server running on port ${PORT}`);
});
